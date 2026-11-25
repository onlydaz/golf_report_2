//! Polling loop: reads the control area periodically and, when DataReady
//! goes 0 -> 1, reads and decodes record [0] of the data area.
//!
//! Read only for now: nothing is written back to the PLC (no PC_ReadCount /
//! PC_ReadDone / PC_Heartbeat).

use std::time::Duration;

use tokio::time::{interval, MissedTickBehavior};

use super::control::{read_control_area, ControlArea};
use super::record::StickRecord;
use super::registers::record;
use super::{PlcError, PlcHandle, PlcStatus};

#[derive(Debug, Clone)]
pub enum PollEvent {
    /// Fresh control area, every successful poll.
    Control(ControlArea),
    /// Record [0], read after a DataReady 0 -> 1 edge.
    Record(StickRecord),
    /// A read failed; the loop keeps going.
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

/// Run until the PLC actor stops.
pub async fn run_poller(plc: PlcHandle, period: Duration, mut emit: impl FnMut(PollEvent)) {
    let mut status = plc.subscribe_status();
    let mut tick = interval(period);
    tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut prev_ready: Option<i16> = None;

    loop {
        // Only poll while connected.
        if status.wait_for(|s| *s == PlcStatus::Connected).await.is_err() {
            return; // actor gone
        }
        tick.tick().await;

        let ctrl = match read_control_area(&plc).await {
            Ok(c) => c,
            Err(PlcError::ActorStopped) => return,
            Err(e) => {
                emit(PollEvent::Error(e));
                continue;
            }
        };
        let now = ctrl.data_ready;
        emit(PollEvent::Control(ctrl));

        if is_rising(prev_ready, now) {
            match read_record0(&plc).await {
                Ok(r) => emit(PollEvent::Record(r)),
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
