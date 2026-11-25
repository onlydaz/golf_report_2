use std::future::Future;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tokio::time::{sleep, timeout};
use tokio_modbus::server::tcp::{accept_tcp_connection, Server};
use tokio_modbus::server::Service;
use tokio_modbus::{ExceptionCode, Request, Response};

use super::*;

const REG_COUNT: usize = 300;
/// Reading this address makes the fake PLC stall, to keep a request in flight.
const SLOW_ADDR: u16 = 100;

#[derive(Clone)]
struct FakePlc {
    regs: Arc<Mutex<Vec<u16>>>,
}

impl Service for FakePlc {
    type Request = Request<'static>;
    type Response = Response;
    type Exception = ExceptionCode;
    type Future = Pin<Box<dyn Future<Output = Result<Response, ExceptionCode>> + Send>>;

    fn call(&self, req: Self::Request) -> Self::Future {
        let regs = self.regs.clone();
        Box::pin(async move {
            match req {
                Request::ReadHoldingRegisters(SLOW_ADDR, _) => {
                    sleep(Duration::from_secs(5)).await;
                    Ok(Response::ReadHoldingRegisters(vec![0]))
                }
                // Same limit as a real Modbus server.
                Request::ReadHoldingRegisters(_, cnt) if cnt > 125 => Err(ExceptionCode::IllegalDataValue),
                Request::ReadHoldingRegisters(addr, cnt) => {
                    let regs = regs.lock().unwrap();
                    let (a, c) = (addr as usize, cnt as usize);
                    regs.get(a..a + c)
                        .map(|s| Response::ReadHoldingRegisters(s.to_vec()))
                        .ok_or(ExceptionCode::IllegalDataAddress)
                }
                Request::WriteSingleRegister(addr, v) => {
                    let mut regs = regs.lock().unwrap();
                    let slot = regs.get_mut(addr as usize).ok_or(ExceptionCode::IllegalDataAddress)?;
                    *slot = v;
                    Ok(Response::WriteSingleRegister(addr, v))
                }
                _ => Err(ExceptionCode::IllegalFunction),
            }
        })
    }
}

async fn start_server(listener: TcpListener) -> JoinHandle<()> {
    let svc = FakePlc { regs: Arc::new(Mutex::new(vec![0; REG_COUNT])) };
    tokio::spawn(async move {
        let server = Server::new(listener);
        let new_svc = move |_| Ok(Some(svc.clone()));
        let on_connected = move |stream, addr| {
            let new_svc = new_svc.clone();
            async move { accept_tcp_connection(stream, addr, new_svc) }
        };
        let _ = server.serve(&on_connected, |_| {}).await;
    })
}

fn test_config(addr: SocketAddr) -> PlcConfig {
    PlcConfig {
        addr,
        slave: 1,
        request_timeout: Duration::from_secs(2),
        connect_timeout: Duration::from_millis(500),
        reconnect_min: Duration::from_millis(50),
        reconnect_max: Duration::from_millis(200),
        queue_capacity: 16,
    }
}

async fn wait_for(plc: &PlcHandle, pred: impl Fn(&PlcStatus) -> bool) {
    let mut rx = plc.subscribe_status();
    timeout(Duration::from_secs(5), rx.wait_for(|s| pred(s)))
        .await
        .expect("status timeout")
        .expect("actor gone");
}

#[tokio::test]
async fn read_write_and_exception_keeps_connection() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let _server = start_server(listener).await;

    let plc = spawn_plc_actor(test_config(addr));
    wait_for(&plc, |s| *s == PlcStatus::Connected).await;

    plc.write_single_register(3, 1234).await.unwrap();
    assert_eq!(plc.read_holding_registers(2, 3).await.unwrap(), vec![0, 1234, 0]);

    // Bad address => Modbus exception, connection still alive.
    let err = plc.read_holding_registers(1000, 1).await.unwrap_err();
    assert!(matches!(err, PlcError::Exception { code: 0x02, .. }), "{err:?}");
    assert_eq!(plc.status(), PlcStatus::Connected);

    // Next request on the same connection still works.
    assert_eq!(plc.read_holding_registers(3, 1).await.unwrap(), vec![1234]);
}

#[tokio::test]
async fn disconnect_fails_queued_requests_and_reconnects() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = start_server(listener).await;

    let plc = spawn_plc_actor(test_config(addr));
    wait_for(&plc, |s| *s == PlcStatus::Connected).await;

    // One request stuck in flight + several queued behind it.
    let mut pending = Vec::new();
    {
        let plc = plc.clone();
        pending.push(tokio::spawn(async move { plc.read_holding_registers(SLOW_ADDR, 1).await }));
    }
    sleep(Duration::from_millis(100)).await;
    for i in 0..5 {
        let plc = plc.clone();
        pending.push(tokio::spawn(async move { plc.read_holding_registers(i, 1).await }));
    }
    sleep(Duration::from_millis(100)).await;

    // "Pull the cable": kill the server and all its connections.
    server.abort();

    for p in pending {
        let res = timeout(Duration::from_secs(3), p).await.unwrap().unwrap();
        assert!(matches!(res, Err(PlcError::Disconnected(_))), "{res:?}");
    }
    wait_for(&plc, |s| *s != PlcStatus::Connected).await;

    // While offline, new requests fail fast.
    assert_eq!(plc.read_holding_registers(0, 1).await, Err(PlcError::NotConnected));

    // PLC comes back => actor reconnects by itself.
    let listener = TcpListener::bind(addr).await.unwrap();
    let _server = start_server(listener).await;
    wait_for(&plc, |s| *s == PlcStatus::Connected).await;
    assert_eq!(plc.read_holding_registers(0, 2).await.unwrap(), vec![0, 0]);
}

#[tokio::test]
async fn long_read_is_split_into_chunks() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let _server = start_server(listener).await;

    let plc = spawn_plc_actor(test_config(addr));
    wait_for(&plc, |s| *s == PlcStatus::Connected).await;

    // Values on both sides of the 125-register chunk boundary.
    for (a, v) in [(10, 1), (134, 2), (135, 3), (249, 4)] {
        plc.write_single_register(a, v).await.unwrap();
    }
    let words = plc.read_holding_registers(10, 240).await.unwrap();
    assert_eq!(words.len(), 240);
    assert_eq!((words[0], words[124], words[125], words[239]), (1, 2, 3, 4));
    assert_eq!(words.iter().filter(|&&w| w != 0).count(), 4);

    // Range past the end of the address space is rejected up front.
    let err = plc.read_holding_registers(65500, 200).await.unwrap_err();
    assert!(matches!(err, PlcError::Exception { code: 0x02, .. }), "{err:?}");
}
