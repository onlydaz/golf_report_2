//! Register map of the X212PI data table (Delta AS200, Modbus TCP).
//!
//! Source: docs/X212PI-Register-Mapping-PLC-Software.xlsx
//!   - sheet `Tong_quan`         : overall layout
//!   - sheet `Vung_dieu_khien`   : control area   -> [`control`]
//!   - sheet `Cau_truc_ban_ghi`  : stick record   -> [`record`]
//!
//! Every address here is a Modbus holding-register address (= D number + [`MODBUS_OFFSET`]).
//! Offsets inside an area are relative to the start of that area.
//!
//! Data types (1 register = 16 bit):
//!   - INT / WORD : 1 register
//!   - DINT / REAL: 2 registers, LOW word at the lower address
//!   - ASCII      : 2 chars per register, first char in the LOW byte, padded with 0
//!
//! Layout:
//!   D25000..D25019  control area (20)
//!   D25020..D25259  record [0]   (240)
//!   D25260..D25499  record [1]   (240)

// Full map is kept even where a field is not read yet.
#![allow(dead_code)]

/// Modbus address = D number + offset. 0 per the spec; verify on the real AS200.
pub const MODBUS_OFFSET: u16 = 0;
/// First D register of the data table (D25000).
pub const BASE: u16 = 25000 + MODBUS_OFFSET;
/// Total registers used by the data table (D25000..D25499).
pub const TOTAL_LEN: u16 = control::LEN + record::LEN * record::COUNT;

/// Control area, D25000..D25019 (sheet `Vung_dieu_khien`).
pub mod control {
    pub const START: u16 = super::BASE;
    pub const LEN: u16 = 20;

    // ---- Written by the PLC
    /// INT. Table format version, currently 1.
    pub const FORMAT_VERSION: u16 = 0;
    /// INT. Registers per record (240).
    pub const RECORD_SIZE: u16 = 1;
    /// INT. Records in the buffer (2).
    pub const BUFFER_COUNT: u16 = 2;
    /// INT. Index of the record the PLC will write next (0/1).
    pub const WRITE_IDX: u16 = 3;
    /// DINT. Total sticks written, only increases.
    pub const TOTAL_COUNT: u16 = 4;
    /// INT. Index of the most recently completed record (0/1).
    pub const LAST_IDX: u16 = 6;
    /// INT. +1 every second, 0..32767 then wraps to 0.
    pub const HEARTBEAT: u16 = 7;
    /// BOOL (INT 0/1). 1 = there are records not yet acknowledged by the PC.
    pub const DATA_READY: u16 = 11;

    // ---- Written by the PC software
    /// DINT. TotalCount the PC has finished reading.
    pub const PC_READ_COUNT: u16 = 8;
    /// INT. PC increments every second.
    pub const PC_HEARTBEAT: u16 = 10;
    /// BOOL (INT 0/1). PC writes 1 after reading; PLC clears records and writes 0.
    pub const PC_READ_DONE: u16 = 12;

    /// INT[7]. Reserved.
    pub const RESERVE: u16 = 13;
    pub const RESERVE_LEN: u16 = 7;
}

/// Stick record `UDT_StickData`, 240 registers, ring buffer of 2 (sheet `Cau_truc_ban_ghi`).
pub mod record {
    use super::control;

    /// Start of record [0] (D25020).
    pub const START: u16 = control::START + control::LEN;
    pub const LEN: u16 = 240;
    pub const COUNT: u16 = 2;

    /// Modbus address of record `idx` (0 or 1).
    pub const fn start(idx: u16) -> u16 {
        START + idx * LEN
    }

    // ---- 1. General info
    /// INT. Record format version (1).
    pub const VERSION: u16 = 0;
    /// WORD, bit field: see [`status`].
    pub const STATUS: u16 = 1;
    /// DINT. Stick serial number (increments at the feed station).
    pub const STICK_NO: u16 = 2;
    /// WORD[10] ASCII. Product code, max 20 chars.
    pub const PRODUCT_CODE: u16 = 4;
    pub const PRODUCT_CODE_LEN: u16 = 10;
    // Offsets 14..19 are not described in the spec and are ignored.
    /// INT. 0 none, 1 OK, 2 NG. OK only if Butt OK and Tip OK.
    pub const OVERALL_RESULT: u16 = 20;
    /// INT. Reserved.
    pub const RESERVE_HEADER: u16 = 21;
    /// DINT. TotalCount at the moment the PLC wrote this record.
    pub const RECORD_SEQ: u16 = 22;

    // ---- 2./3. Stations (same layout, read with one function)
    /// Station 2, butt end.
    pub const BUTT: u16 = 24;
    /// Station 3, tip end. Unused points/attempts are left as 0.
    pub const TIP: u16 = 120;

    // ---- 4. Reserved
    /// INT[24]. Reserved for future fields.
    pub const RESERVE_END: u16 = 216;
    pub const RESERVE_END_LEN: u16 = 24;

    /// Bits of [`STATUS`].
    pub mod status {
        /// Record valid, not yet acknowledged (PLC clears after PC_ReadDone).
        pub const VALID: u16 = 1 << 0;
        pub const BUTT_CHECKED: u16 = 1 << 1;
        pub const TIP_CHECKED: u16 = 1 << 2;
        pub const OVERALL_OK: u16 = 1 << 3;
    }

    /// Station block: offsets relative to [`BUTT`] or [`TIP`].
    pub mod station {
        pub const LEN: u16 = 96;

        /// INT. 0 not measured, 1 OK, 2 NG.
        pub const RESULT: u16 = 0;
        /// INT. Points measured (stops early when one point is NG 4 times).
        pub const POINT_COUNT: u16 = 1;
        /// INT. NG point (1..4), 0 if OK.
        pub const NG_POINT: u16 = 2;
        /// INT. Reserved.
        pub const RESERVE1: u16 = 3;
        /// REAL, g. Load placed on the stick end during measurement.
        pub const LOAD: u16 = 4;
        /// INT[2]. Reserved.
        pub const RESERVE2: u16 = 6;
        /// First measuring point.
        pub const POINTS: u16 = 8;
        /// Number of measuring points per station.
        pub const NUM_POINTS: u16 = 4;

        /// Offset of point `n` (1..=4) inside the station.
        pub const fn point(n: u16) -> u16 {
            POINTS + (n - 1) * super::point::LEN
        }
    }

    /// Measuring point: offsets relative to [`station::point`].
    pub mod point {
        pub const LEN: u16 = 22;

        /// INT. 0 not measured, 1 OK, 2 NG.
        pub const RESULT: u16 = 0;
        /// INT. Attempts made at this point (1..4).
        pub const ATTEMPT_COUNT: u16 = 1;
        /// INT. Attempt that decided the result. Angle = (attempt - 1) * 90°.
        pub const DECIDE_ATTEMPT: u16 = 2;
        /// INT. Reserved.
        pub const RESERVE: u16 = 3;
        /// REAL, mm. Position of the point along the shaft.
        pub const POSITION: u16 = 4;
        /// First attempt.
        pub const ATTEMPTS: u16 = 6;
        /// Number of attempts per point (rotated 90° between attempts).
        pub const NUM_ATTEMPTS: u16 = 4;

        /// Offset of attempt `k` (1..=4) inside the point.
        pub const fn attempt(k: u16) -> u16 {
            ATTEMPTS + (k - 1) * super::attempt::LEN
        }
    }

    /// One attempt: offsets relative to [`point::attempt`].
    pub mod attempt {
        pub const LEN: u16 = 4;
        /// REAL, mm. Push distance.
        pub const PUSH_DIST: u16 = 0;
        /// REAL, mm. Measured bend.
        pub const BEND: u16 = 2;
    }

    // Layout sanity checks (fail at compile time if the map is edited inconsistently).
    const _: () = {
        assert!(point::attempt(point::NUM_ATTEMPTS) + attempt::LEN == point::LEN);
        assert!(station::point(station::NUM_POINTS) + point::LEN == station::LEN);
        assert!(BUTT + station::LEN == TIP);
        assert!(TIP + station::LEN == RESERVE_END);
        assert!(RESERVE_END + RESERVE_END_LEN == LEN);
        assert!(PRODUCT_CODE + PRODUCT_CODE_LEN <= OVERALL_RESULT);
    };
}

const _: () = assert!(control::RESERVE + control::RESERVE_LEN == control::LEN);

#[cfg(test)]
mod tests {
    use super::record::*;
    use super::*;

    /// Absolute addresses spot-checked against the Excel sheets.
    #[test]
    fn matches_excel() {
        assert_eq!(control::START + control::PC_READ_DONE, 25012);
        assert_eq!(record::start(0), 25020);
        assert_eq!(record::start(1), 25260);
        assert_eq!(BASE + TOTAL_LEN - 1, 25499);

        assert_eq!(start(0) + OVERALL_RESULT, 25040);
        assert_eq!(start(1) + RECORD_SEQ, 25282);
        // BUTT_Load, BUTT_P1_Position, BUTT_P2_A1_PushDist
        assert_eq!(start(0) + BUTT + station::LOAD, 25048);
        assert_eq!(start(0) + BUTT + station::point(1) + point::POSITION, 25056);
        assert_eq!(start(0) + BUTT + station::point(2) + point::attempt(1) + attempt::PUSH_DIST, 25080);
        // BUTT_P4_A4_Bend
        assert_eq!(start(0) + BUTT + station::point(4) + point::attempt(4) + attempt::BEND, 25138);
        // TIP_Result, TIP_P3_DecideAttempt, TIP_P4_A4_Bend (record 1)
        assert_eq!(start(0) + TIP + station::RESULT, 25140);
        assert_eq!(start(0) + TIP + station::point(3) + point::DECIDE_ATTEMPT, 25194);
        assert_eq!(start(1) + TIP + station::point(4) + point::attempt(4) + attempt::BEND, 25474);
        assert_eq!(start(1) + RESERVE_END, 25476);
    }
}
