//! Control area at the start of the X212PI data table
//! (docs/X212PI-Register-Mapping-PLC-Software.xlsx, sheet `Vung_dieu_khien`).
//! Addresses come from [`super::registers::control`].

use serde::Serialize;

use super::decode::{dint, int};
use super::registers::control::{self as reg, LEN, START};
use super::{PlcError, PlcHandle};

/// Decoded control area. INT = i16, DINT = i32 (low word at the lower address).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlArea {
    pub format_version: i16, // +0
    pub record_size: i16,    // +1
    pub buffer_count: i16,   // +2
    pub write_idx: i16,      // +3
    pub total_count: i32,    // +4..5
    pub last_idx: i16,       // +6
    pub heartbeat: i16,      // +7
    pub pc_read_count: i32,  // +8..9
    pub pc_heartbeat: i16,   // +10
    pub data_ready: i16,     // +11
    pub pc_read_done: i16,   // +12
    /// Raw words D25000..D25019, for display/debugging.
    pub raw: Vec<u16>,
}

impl ControlArea {
    /// Decode from the `control::LEN` words starting at `control::START`.
    pub fn decode(w: &[u16]) -> Option<Self> {
        if w.len() < LEN as usize {
            return None;
        }
        let int = |o| int(w, o);
        let dint = |o| dint(w, o);
        Some(Self {
            format_version: int(reg::FORMAT_VERSION),
            record_size: int(reg::RECORD_SIZE),
            buffer_count: int(reg::BUFFER_COUNT),
            write_idx: int(reg::WRITE_IDX),
            total_count: dint(reg::TOTAL_COUNT),
            last_idx: int(reg::LAST_IDX),
            heartbeat: int(reg::HEARTBEAT),
            pc_read_count: dint(reg::PC_READ_COUNT),
            pc_heartbeat: int(reg::PC_HEARTBEAT),
            data_ready: int(reg::DATA_READY),
            pc_read_done: int(reg::PC_READ_DONE),
            raw: w[..LEN as usize].to_vec(),
        })
    }
}

/// Read and decode the control area from the PLC.
pub async fn read_control_area(plc: &PlcHandle) -> Result<ControlArea, PlcError> {
    let words = plc.read_holding_registers(START, LEN).await?;
    ControlArea::decode(&words).ok_or_else(|| PlcError::Exception {
        code: 0,
        message: format!("expected {LEN} registers, got {}", words.len()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_low_word_first() {
        let mut w = vec![0u16; LEN as usize];
        w[0] = 1;
        w[1] = 240;
        w[2] = 2;
        w[3] = 1;
        w[4] = 0x0002; // TotalCount low
        w[5] = 0x0001; // TotalCount high -> 0x0001_0002 = 65538
        w[7] = 0xFFFF; // heartbeat as i16 = -1
        w[8] = 0xFFFE; // PC_ReadCount low
        w[9] = 0xFFFF; // PC_ReadCount high -> -2
        w[11] = 1;
        let c = ControlArea::decode(&w).unwrap();
        assert_eq!(c.format_version, 1);
        assert_eq!(c.record_size, 240);
        assert_eq!(c.buffer_count, 2);
        assert_eq!(c.write_idx, 1);
        assert_eq!(c.total_count, 65538);
        assert_eq!(c.heartbeat, -1);
        assert_eq!(c.pc_read_count, -2);
        assert_eq!(c.data_ready, 1);
        assert!(ControlArea::decode(&w[..19]).is_none());
    }
}
