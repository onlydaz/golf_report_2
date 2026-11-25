use std::time::Duration;

use serde::Serialize;
use tokio::sync::{mpsc, oneshot, watch};
use tokio::time::{sleep, timeout};
use tokio_modbus::client::{tcp, Client, Context, Reader, Writer};
use tokio_modbus::Slave;

use super::{PlcConfig, PlcError, PlcHandle};

/// A single Modbus operation.
#[derive(Debug, Clone)]
pub enum PlcOp {
    ReadCoils { addr: u16, count: u16 },
    ReadDiscreteInputs { addr: u16, count: u16 },
    ReadHoldingRegisters { addr: u16, count: u16 },
    ReadInputRegisters { addr: u16, count: u16 },
    WriteSingleCoil { addr: u16, value: bool },
    WriteSingleRegister { addr: u16, value: u16 },
    WriteMultipleCoils { addr: u16, values: Vec<bool> },
    WriteMultipleRegisters { addr: u16, values: Vec<u16> },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlcValue {
    Bits(Vec<bool>),
    Words(Vec<u16>),
    Unit,
}

pub struct PlcRequest {
    pub op: PlcOp,
    pub reply: oneshot::Sender<Result<PlcValue, PlcError>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum PlcStatus {
    Connecting,
    Connected,
    Disconnected { reason: String },
}

/// Outcome of executing one operation against a live connection.
enum ExecError {
    /// Modbus exception from the PLC: connection stays open.
    Exception(PlcError),
    /// Transport/protocol failure or timeout: connection must be closed.
    Disconnect(String),
}

/// Spawn the PLC actor and return a handle to talk to it.
///
/// The actor stops when every [`PlcHandle`] has been dropped.
pub fn spawn_plc_actor(cfg: PlcConfig) -> PlcHandle {
    let (tx, rx) = mpsc::channel(cfg.queue_capacity);
    let (status_tx, status_rx) = watch::channel(PlcStatus::Connecting);
    tauri::async_runtime::spawn(run(cfg, rx, status_tx));
    PlcHandle::new(tx, status_rx)
}

async fn run(
    cfg: PlcConfig,
    mut rx: mpsc::Receiver<PlcRequest>,
    status: watch::Sender<PlcStatus>,
) {
    let mut backoff = Duration::ZERO;
    loop {
        // ---- Not connected: try to (re)connect, rejecting requests meanwhile.
        let Some(mut ctx) = connect(&cfg, &mut rx, &status, backoff).await else {
            return; // all handles dropped
        };
        backoff = cfg.reconnect_min;
        status.send_replace(PlcStatus::Connected);

        // ---- Connected: process requests one by one.
        let reason = loop {
            let Some(req) = rx.recv().await else {
                let _ = ctx.disconnect().await;
                return;
            };
            match execute(&mut ctx, &req.op, cfg.request_timeout).await {
                Ok(value) => {
                    let _ = req.reply.send(Ok(value));
                }
                Err(ExecError::Exception(err)) => {
                    let _ = req.reply.send(Err(err));
                }
                Err(ExecError::Disconnect(reason)) => {
                    let _ = req.reply.send(Err(PlcError::Disconnected(reason.clone())));
                    break reason;
                }
            }
        };

        // ---- Connection lost: close it and fail everything still buffered.
        let _ = ctx.disconnect().await;
        while let Ok(req) = rx.try_recv() {
            let _ = req.reply.send(Err(PlcError::Disconnected(reason.clone())));
        }
        status.send_replace(PlcStatus::Disconnected { reason });
    }
}

/// Keep trying to connect with exponential backoff. While waiting, incoming
/// requests are answered immediately with [`PlcError::NotConnected`].
/// Returns `None` if the request channel is closed.
async fn connect(
    cfg: &PlcConfig,
    rx: &mut mpsc::Receiver<PlcRequest>,
    status: &watch::Sender<PlcStatus>,
    mut backoff: Duration,
) -> Option<Context> {
    loop {
        let delay = backoff;
        let attempt = async move {
            sleep(delay).await;
            status.send_if_modified(|s| {
                if *s == PlcStatus::Connecting {
                    false
                } else {
                    *s = PlcStatus::Connecting;
                    true
                }
            });
            match timeout(cfg.connect_timeout, tcp::connect_slave(cfg.addr, Slave(cfg.slave))).await
            {
                Ok(Ok(ctx)) => Ok(ctx),
                Ok(Err(e)) => Err(e.to_string()),
                Err(_) => Err("connect timeout".to_string()),
            }
        };
        tokio::pin!(attempt);

        let result = loop {
            tokio::select! {
                res = &mut attempt => break res,
                req = rx.recv() => match req {
                    Some(req) => { let _ = req.reply.send(Err(PlcError::NotConnected)); }
                    None => return None,
                },
            }
        };

        match result {
            Ok(ctx) => return Some(ctx),
            Err(reason) => {
                status.send_replace(PlcStatus::Disconnected { reason });
                backoff = (backoff * 2).clamp(cfg.reconnect_min, cfg.reconnect_max);
            }
        }
    }
}

async fn execute(ctx: &mut Context, op: &PlcOp, req_timeout: Duration) -> Result<PlcValue, ExecError> {
    let fut = async {
        Ok::<_, tokio_modbus::Error>(match op {
            PlcOp::ReadCoils { addr, count } => {
                ctx.read_coils(*addr, *count).await?.map(PlcValue::Bits)
            }
            PlcOp::ReadDiscreteInputs { addr, count } => {
                ctx.read_discrete_inputs(*addr, *count).await?.map(PlcValue::Bits)
            }
            PlcOp::ReadHoldingRegisters { addr, count } => {
                ctx.read_holding_registers(*addr, *count).await?.map(PlcValue::Words)
            }
            PlcOp::ReadInputRegisters { addr, count } => {
                ctx.read_input_registers(*addr, *count).await?.map(PlcValue::Words)
            }
            PlcOp::WriteSingleCoil { addr, value } => {
                ctx.write_single_coil(*addr, *value).await?.map(|()| PlcValue::Unit)
            }
            PlcOp::WriteSingleRegister { addr, value } => {
                ctx.write_single_register(*addr, *value).await?.map(|()| PlcValue::Unit)
            }
            PlcOp::WriteMultipleCoils { addr, values } => {
                ctx.write_multiple_coils(*addr, values).await?.map(|()| PlcValue::Unit)
            }
            PlcOp::WriteMultipleRegisters { addr, values } => {
                ctx.write_multiple_registers(*addr, values).await?.map(|()| PlcValue::Unit)
            }
        })
    };

    match timeout(req_timeout, fut).await {
        Ok(Ok(Ok(value))) => Ok(value),
        Ok(Ok(Err(code))) => Err(ExecError::Exception(code.into())),
        // Transport errors (EOF, reset, broken pipe) and protocol errors
        // (mismatched headers => stream out of sync) both require a fresh connection.
        Ok(Err(err)) => Err(ExecError::Disconnect(err.to_string())),
        // A late response would desync the next transaction, so drop the connection.
        Err(_) => Err(ExecError::Disconnect("request timeout".to_string())),
    }
}
