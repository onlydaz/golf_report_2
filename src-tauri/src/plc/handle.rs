use tokio::sync::{mpsc, oneshot, watch};

use super::actor::{PlcOp, PlcRequest, PlcValue};
use super::{PlcError, PlcStatus};

/// Max registers in one Modbus read request (FC03/FC04, spec limit).
pub const MAX_READ_REGISTERS: u16 = 125;

/// Cheap, cloneable handle used to send requests to the PLC actor.
#[derive(Clone)]
pub struct PlcHandle {
    tx: mpsc::Sender<PlcRequest>,
    status: watch::Receiver<PlcStatus>,
}

impl PlcHandle {
    pub(super) fn new(tx: mpsc::Sender<PlcRequest>, status: watch::Receiver<PlcStatus>) -> Self {
        Self { tx, status }
    }

    /// Current connection status.
    pub fn status(&self) -> PlcStatus {
        self.status.borrow().clone()
    }

    /// Subscribe to connection status changes.
    pub fn subscribe_status(&self) -> watch::Receiver<PlcStatus> {
        self.status.clone()
    }

    async fn request(&self, op: PlcOp) -> Result<PlcValue, PlcError> {
        let (reply, rx) = oneshot::channel();
        self.tx
            .send(PlcRequest { op, reply })
            .await
            .map_err(|_| PlcError::ActorStopped)?;
        rx.await.map_err(|_| PlcError::ActorStopped)?
    }

    async fn bits(&self, op: PlcOp) -> Result<Vec<bool>, PlcError> {
        match self.request(op).await? {
            PlcValue::Bits(v) => Ok(v),
            other => unreachable!("expected bits, got {other:?}"),
        }
    }

    async fn words(&self, op: PlcOp) -> Result<Vec<u16>, PlcError> {
        match self.request(op).await? {
            PlcValue::Words(v) => Ok(v),
            other => unreachable!("expected words, got {other:?}"),
        }
    }

    /// Read `count` registers, split into requests of at most [`MAX_READ_REGISTERS`].
    /// Chunks are sent one after another; the first failure aborts the read.
    async fn words_chunked(
        &self,
        addr: u16,
        count: u16,
        op: fn(u16, u16) -> PlcOp,
    ) -> Result<Vec<u16>, PlcError> {
        if count <= MAX_READ_REGISTERS {
            return self.words(op(addr, count)).await;
        }
        if addr as u32 + count as u32 > 1 << 16 {
            return Err(tokio_modbus::ExceptionCode::IllegalDataAddress.into());
        }
        let mut out = Vec::with_capacity(count as usize);
        let mut done = 0;
        while done < count {
            let n = (count - done).min(MAX_READ_REGISTERS);
            out.extend(self.words(op(addr + done, n)).await?);
            done += n;
        }
        Ok(out)
    }

    async fn unit(&self, op: PlcOp) -> Result<(), PlcError> {
        self.request(op).await.map(|_| ())
    }

    pub async fn read_coils(&self, addr: u16, count: u16) -> Result<Vec<bool>, PlcError> {
        self.bits(PlcOp::ReadCoils { addr, count }).await
    }

    pub async fn read_discrete_inputs(&self, addr: u16, count: u16) -> Result<Vec<bool>, PlcError> {
        self.bits(PlcOp::ReadDiscreteInputs { addr, count }).await
    }

    /// Reads longer than [`MAX_READ_REGISTERS`] are split into several requests.
    pub async fn read_holding_registers(&self, addr: u16, count: u16) -> Result<Vec<u16>, PlcError> {
        self.words_chunked(addr, count, |addr, count| PlcOp::ReadHoldingRegisters { addr, count })
            .await
    }

    /// Reads longer than [`MAX_READ_REGISTERS`] are split into several requests.
    pub async fn read_input_registers(&self, addr: u16, count: u16) -> Result<Vec<u16>, PlcError> {
        self.words_chunked(addr, count, |addr, count| PlcOp::ReadInputRegisters { addr, count })
            .await
    }

    pub async fn write_single_coil(&self, addr: u16, value: bool) -> Result<(), PlcError> {
        self.unit(PlcOp::WriteSingleCoil { addr, value }).await
    }

    pub async fn write_single_register(&self, addr: u16, value: u16) -> Result<(), PlcError> {
        self.unit(PlcOp::WriteSingleRegister { addr, value }).await
    }

    pub async fn write_multiple_coils(&self, addr: u16, values: Vec<bool>) -> Result<(), PlcError> {
        self.unit(PlcOp::WriteMultipleCoils { addr, values }).await
    }

    pub async fn write_multiple_registers(&self, addr: u16, values: Vec<u16>) -> Result<(), PlcError> {
        self.unit(PlcOp::WriteMultipleRegisters { addr, values }).await
    }
}
