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

/// Covers the X212PI data table D25000..D25499.
const REG_COUNT: usize = 25500;
/// Reading this address makes the fake PLC stall, to keep a request in flight.
const SLOW_ADDR: u16 = 100;

#[tokio::test]
async fn shutdown_pause_waits_for_save_and_ack_and_resumes_without_duplicate_record() {
    use tokio::sync::{mpsc, watch, Notify};
    use super::registers::control;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = start_server(listener).await;
    let plc = spawn_plc_actor(test_config(addr));
    wait_for(&plc, |s| *s == PlcStatus::Connected).await;
    let (pause, pause_rx) = watch::channel(false);
    let (paused, mut paused_rx) = watch::channel(false);
    let (events, mut rx) = mpsc::unbounded_channel();
    let (saves, mut saved) = mpsc::unbounded_channel();
    let release = Arc::new(Notify::new());
    let save_release = release.clone();
    let poller = tokio::spawn(run_poller_with_shutdown(plc.clone(), Duration::from_millis(10),
        move |e| { let _ = events.send(e); },
        move |r| {
            let saves = saves.clone();
            let release = save_release.clone();
            async move { saves.send(r).unwrap(); release.notified().await; }
        }, pause_rx, paused));
    timeout(Duration::from_secs(2), async {
        while !matches!(rx.recv().await, Some(PollEvent::Control(c)) if c.data_ready == 0) {}
    }).await.unwrap();
    plc.write_single_register(control::START + control::DATA_READY, 1).await.unwrap();
    timeout(Duration::from_secs(2), saved.recv()).await.unwrap().unwrap();
    pause.send_replace(true);
    assert!(timeout(Duration::from_millis(80), paused_rx.wait_for(|v| *v)).await.is_err());
    release.notify_one();
    timeout(Duration::from_secs(2), paused_rx.wait_for(|v| *v)).await.unwrap().unwrap();
    let c = super::control::read_control_area(&plc).await.unwrap();
    assert_eq!((c.pc_read_count, c.pc_read_done), (1, 1));
    pause.send_replace(false);
    timeout(Duration::from_secs(2), paused_rx.wait_for(|v| !v)).await.unwrap().unwrap();
    assert!(timeout(Duration::from_millis(80), saved.recv()).await.is_err());
    plc.write_single_register(control::START + control::DATA_READY, 0).await.unwrap();
    timeout(Duration::from_secs(2), async {
        while !matches!(rx.recv().await, Some(PollEvent::Control(c)) if c.data_ready == 0 && c.pc_read_count == 1) {}
    }).await.unwrap();
    plc.write_single_register(control::START + control::DATA_READY, 1).await.unwrap();
    timeout(Duration::from_secs(2), saved.recv()).await.unwrap().unwrap();
    release.notify_one();
    pause.send_replace(true);
    timeout(Duration::from_secs(2), paused_rx.wait_for(|v| *v)).await.unwrap().unwrap();
    assert_eq!(super::control::read_control_area(&plc).await.unwrap().pc_read_count, 2);
    poller.abort(); server.abort();
}

#[tokio::test]
async fn shutdown_pause_also_works_when_plc_is_offline_without_pending_ack() {
    use tokio::sync::watch;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    drop(listener);
    let plc = spawn_plc_actor(test_config(addr));
    let (pause, pause_rx) = watch::channel(false);
    let (paused, mut paused_rx) = watch::channel(false);
    let poller = tokio::spawn(run_poller_with_shutdown(plc, Duration::from_millis(10), |_| {}, |_| async {}, pause_rx, paused));
    pause.send_replace(true);
    timeout(Duration::from_secs(2), paused_rx.wait_for(|v| *v)).await.unwrap().unwrap();
    poller.abort();
}

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
                // Same limit and error as the real Delta AS200.
                Request::ReadHoldingRegisters(_, cnt) if cnt > 100 => Err(ExceptionCode::ServerDeviceFailure),
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
                Request::WriteMultipleRegisters(addr, values) => {
                    let mut regs = regs.lock().unwrap();
                    let (a, n) = (addr as usize, values.len());
                    let slots = regs.get_mut(a..a + n).ok_or(ExceptionCode::IllegalDataAddress)?;
                    slots.copy_from_slice(&values);
                    Ok(Response::WriteMultipleRegisters(addr, n as u16))
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
        poll_interval: Duration::from_millis(20),
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
    let err = plc.read_holding_registers(REG_COUNT as u16, 1).await.unwrap_err();
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

    // Values on both sides of the 100-register chunk boundaries.
    for (a, v) in [(10, 1), (109, 2), (110, 3), (249, 4)] {
        plc.write_single_register(a, v).await.unwrap();
    }
    let words = plc.read_holding_registers(10, 240).await.unwrap();
    assert_eq!(words.len(), 240);
    assert_eq!((words[0], words[99], words[100], words[239]), (1, 2, 3, 4));
    assert_eq!(words.iter().filter(|&&w| w != 0).count(), 4);

    // Range past the end of the address space is rejected up front.
    let err = plc.read_holding_registers(65500, 200).await.unwrap_err();
    assert!(matches!(err, PlcError::Exception { code: 0x02, .. }), "{err:?}");
}

#[tokio::test]
async fn poller_reads_record_on_rising_edge() {
    use registers::{control, record};
    use tokio::sync::mpsc;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let _server = start_server(listener).await;

    let cfg = test_config(addr);
    let plc = spawn_plc_actor(cfg.clone());
    wait_for(&plc, |s| *s == PlcStatus::Connected).await;

    let ready = control::START + control::DATA_READY;
    // DataReady already 1 at start + a marker StickNo in record [0].
    plc.write_single_register(ready, 1).await.unwrap();
    plc.write_single_register(record::start(0) + record::STICK_NO, 4242).await.unwrap();

    let (tx, mut rx) = mpsc::unbounded_channel();
    let poller = tokio::spawn(run_poller(
        plc.clone(),
        cfg.poll_interval,
        move |ev| {
            let _ = tx.send(ev);
        },
        |_| async {},
    ));

    // Wait for `n` control polls, collecting the records seen meanwhile.
    async fn collect(rx: &mut mpsc::UnboundedReceiver<PollEvent>, n: usize) -> Vec<super::record::StickRecord> {
        let mut recs = Vec::new();
        let mut polls = 0;
        while polls < n {
            match timeout(Duration::from_secs(3), rx.recv()).await.unwrap().unwrap() {
                PollEvent::Control(_) => polls += 1,
                PollEvent::ReadDiagnostics { .. } => {},
                PollEvent::Record(r) => recs.push(r),
                PollEvent::Error(e) => panic!("{e:?}"),
            }
        }
        recs
    }

    // Already 1 at start: not an edge.
    assert!(collect(&mut rx, 3).await.is_empty());

    let ctrl = || async { super::control::read_control_area(&plc).await.unwrap() };
    let done = control::START + control::PC_READ_DONE;

    // Acts like the PLC for one stick: DataReady 0 -> 1, expect exactly one record + ack.
    // PC_ReadDone goes back to 0 first, as the real PLC does after the ack.
    async fn edge(plc: &PlcHandle, rx: &mut mpsc::UnboundedReceiver<PollEvent>, ready: u16, done: u16) {
        plc.write_single_register(done, 0).await.unwrap();
        plc.write_single_register(ready, 0).await.unwrap();
        assert!(collect(rx, 3).await.is_empty());
        plc.write_single_register(ready, 1).await.unwrap();
        let recs = collect(rx, 3).await;
        assert_eq!(recs.len(), 1);
        assert_eq!(recs[0].stick_no, 4242);
    }

    // Nothing acked yet.
    assert_eq!(ctrl().await.pc_read_count, 0);

    edge(&plc, &mut rx, ready, done).await;
    let c = ctrl().await;
    assert_eq!((c.pc_read_count, c.pc_read_done), (1, 1));

    // Staying at 1: no more reads, no more acks.
    assert!(collect(&mut rx, 3).await.is_empty());
    assert_eq!(ctrl().await.pc_read_count, 1);

    edge(&plc, &mut rx, ready, done).await;
    let c = ctrl().await;
    assert_eq!((c.pc_read_count, c.pc_read_done), (2, 1));

    // Reset to 0: the next ack writes 1.
    write_pc_read_count(&plc, 0).await.unwrap();
    edge(&plc, &mut rx, ready, done).await;
    assert_eq!(ctrl().await.pc_read_count, 1);

    // DINT is written low word first.
    write_pc_read_count(&plc, 0x0001_FFFF).await.unwrap();
    let w = plc.read_holding_registers(control::START + control::PC_READ_COUNT, 2).await.unwrap();
    assert_eq!(w, vec![0xFFFF, 0x0001]);

    poller.abort();
}
