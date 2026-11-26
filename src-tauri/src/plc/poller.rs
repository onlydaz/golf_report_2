//! Polling loop: reads the control area periodically and, when DataReady
//! goes 0 -> 1, reads and decodes record [0] of the data area, hands it to
//! `save` and then acknowledges it to the PLC:
//!   1. PC_ReadCount = previous PC_ReadCount + 1
//!   2. PC_ReadDone  = 1 (the PLC clears the record and writes it back to 0)
//!
//! The PLC is acknowledged even when saving failed (`save` reports its own errors).

use std::future::Future;
use std::time::{Duration, Instant};

use tokio::time::{interval, MissedTickBehavior};

use super::control::{read_control_area, ControlArea};
use super::record::StickRecord;
use super::registers::{control, record};
use super::{PlcError, PlcHandle, PlcStatus};

#[derive(Debug, Clone)]
pub enum PollEvent {
    /// Timing and outcome of an existing read, with no extra PLC request.
    ReadDiagnostics { elapsed_ms: f64, failed: bool },
    /// Fresh control area, every successful poll.
    Control(ControlArea),
    /// Record [0], read after a DataReady 0 -> 1 edge.
    Record(StickRecord),
    /// A read or write failed; the loop keeps going.
    Error(PlcError),
}

/// DataReady rising edge. The first value seen (`prev == None`) never counts.
fn is_rising(prev: Option<i16>, now: i16) -> bool {
    prev == Some(0) && now == 1
}

async fn read_record0(plc: &PlcHandle) -> Result<StickRecord, PlcError> {
    let words = plc.read_holding_registers(record::start(0), record::LEN).await?;
    StickRecord::decode(&words).ok_or_else(|| PlcError::Exception {
        code: 0,
        message: format!("expected {} registers, got {}", record::LEN, words.len()),
    })
}

/// Write PC_ReadCount (DINT, low word first).
pub async fn write_pc_read_count(plc: &PlcHandle, value: i32) -> Result<(), PlcError> {
    let v = value as u32;
    plc.write_multiple_registers(
        control::START + control::PC_READ_COUNT,
        vec![(v & 0xFFFF) as u16, (v >> 16) as u16],
    )
    .await
}

/// Tell the PLC the record is done: PC_ReadCount = `count`, then PC_ReadDone = 1.
async fn ack(plc: &PlcHandle, count: i32) -> Result<(), PlcError> {
    write_pc_read_count(plc, count).await?;
    plc.write_single_register(control::START + control::PC_READ_DONE, 1).await
}

/// Run until the PLC actor stops.
pub async fn run_poller<F, Fut>(
    plc: PlcHandle,
    period: Duration,
    mut emit: impl FnMut(PollEvent),
    mut save: F,
) where
    F: FnMut(StickRecord) -> Fut,
    Fut: Future<Output = ()>,
{
    let mut status = plc.subscribe_status();
    let mut tick = interval(period);
    tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut prev_ready: Option<i16> = None;
    // PC_ReadCount of a record already saved whose ack write failed.
    let mut pending_ack: Option<i32> = None;

    loop {
        // Only poll while connected.
        if status.wait_for(|s| *s == PlcStatus::Connected).await.is_err() {
            return; // actor gone
        }
        tick.tick().await;

        let read_started = Instant::now();
        let result = read_control_area(&plc).await;
        emit(PollEvent::ReadDiagnostics { elapsed_ms: read_started.elapsed().as_secs_f64() * 1000.0, failed: result.is_err() });
        let ctrl = match result {
            Ok(c) => c,
            Err(PlcError::ActorStopped) => return,
            Err(e) => {
                emit(PollEvent::Error(e));
                continue;
            }
        };
        let now = ctrl.data_ready;
        let read_count = ctrl.pc_read_count;
        emit(PollEvent::Control(ctrl));

        // Retry only the ack; the record is already saved.
        if let Some(count) = pending_ack {
            match ack(&plc, count).await {
                Ok(()) => pending_ack = None,
                Err(PlcError::ActorStopped) => return,
                Err(e) => emit(PollEvent::Error(e)),
            }
            prev_ready = Some(now);
            continue;
        }

        if is_rising(prev_ready, now) {
            let read_started = Instant::now();
            let result = read_record0(&plc).await;
            emit(PollEvent::ReadDiagnostics { elapsed_ms: read_started.elapsed().as_secs_f64() * 1000.0, failed: result.is_err() });
            match result {
                Ok(r) => {
                    emit(PollEvent::Record(r.clone()));
                    save(r).await;
                    let count = read_count.wrapping_add(1);
                    match ack(&plc, count).await {
                        Ok(()) => {}
                        Err(PlcError::ActorStopped) => return,
                        Err(e) => {
                            pending_ack = Some(count);
                            emit(PollEvent::Error(e));
                        }
                    }
                }
                Err(PlcError::ActorStopped) => return,
                Err(e) => {
                    // Keep prev_ready at 0 so the next tick retries the read.
                    emit(PollEvent::Error(e));
                    continue;
                }
            }
        }
        prev_ready = Some(now);
    }
}

#[cfg(test)]
mod tests {
    use super::is_rising;

    #[test]
    fn rising_edge_only_from_zero() {
        assert!(is_rising(Some(0), 1));
        assert!(!is_rising(None, 1));
        assert!(!is_rising(Some(1), 1));
        assert!(!is_rising(Some(0), 0));
        assert!(!is_rising(Some(1), 0));
    }
}
