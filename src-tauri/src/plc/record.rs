//! Stick record `UDT_StickData` (sheet `Cau_truc_ban_ghi`), 240 registers.
//! Offsets come from [`super::registers::record`].

use serde::Serialize;

use super::decode::{ascii, dint, int, real, word};
use super::registers::record::{self as reg, attempt, point, station, status};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attempt {
    /// mm
    pub push_dist: f32,
    /// mm
    pub bend: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    /// 0 not measured, 1 OK, 2 NG.
    pub result: i16,
    pub attempt_count: i16,
    pub decide_attempt: i16,
    /// mm
    pub position: f32,
    pub attempts: Vec<Attempt>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Station {
    /// 0 not measured, 1 OK, 2 NG.
    pub result: i16,
    pub point_count: i16,
    pub ng_point: i16,
    /// g
    pub load: f32,
    pub points: Vec<Point>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordStatus {
    pub raw: u16,
    pub valid: bool,
    pub butt_checked: bool,
    pub tip_checked: bool,
    pub overall_ok: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StickRecord {
    pub version: i16,
    pub status: RecordStatus,
    pub stick_no: i32,
    pub product_code: String,
    /// 0 none, 1 OK, 2 NG.
    pub overall_result: i16,
    pub record_seq: i32,
    pub butt: Station,
    pub tip: Station,
    /// Raw words of the record, for display/debugging.
    pub raw: Vec<u16>,
}

fn decode_point(w: &[u16], base: u16) -> Point {
    Point {
        result: int(w, base + point::RESULT),
        attempt_count: int(w, base + point::ATTEMPT_COUNT),
        decide_attempt: int(w, base + point::DECIDE_ATTEMPT),
        position: real(w, base + point::POSITION),
        attempts: (1..=point::NUM_ATTEMPTS)
            .map(|k| {
                let a = base + point::attempt(k);
                Attempt {
                    push_dist: real(w, a + attempt::PUSH_DIST),
                    bend: real(w, a + attempt::BEND),
                }
            })
            .collect(),
    }
}

/// BUTT and TIP share the same layout.
fn decode_station(w: &[u16], base: u16) -> Station {
    Station {
        result: int(w, base + station::RESULT),
        point_count: int(w, base + station::POINT_COUNT),
        ng_point: int(w, base + station::NG_POINT),
        load: real(w, base + station::LOAD),
        points: (1..=station::NUM_POINTS)
            .map(|n| decode_point(w, base + station::point(n)))
            .collect(),
    }
}

impl StickRecord {
    /// Decode from the `record::LEN` words of one record.
    pub fn decode(w: &[u16]) -> Option<Self> {
        if w.len() < reg::LEN as usize {
            return None;
        }
        let st = word(w, reg::STATUS);
        Some(Self {
            version: int(w, reg::VERSION),
            status: RecordStatus {
                raw: st,
                valid: st & status::VALID != 0,
                butt_checked: st & status::BUTT_CHECKED != 0,
                tip_checked: st & status::TIP_CHECKED != 0,
                overall_ok: st & status::OVERALL_OK != 0,
            },
            stick_no: dint(w, reg::STICK_NO),
            product_code: ascii(w, reg::PRODUCT_CODE, reg::PRODUCT_CODE_LEN),
            overall_result: int(w, reg::OVERALL_RESULT),
            record_seq: dint(w, reg::RECORD_SEQ),
            butt: decode_station(w, reg::BUTT),
            tip: decode_station(w, reg::TIP),
            raw: w[..reg::LEN as usize].to_vec(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn put_real(w: &mut [u16], o: u16, v: f32) {
        let b = v.to_bits();
        w[o as usize] = (b & 0xFFFF) as u16;
        w[o as usize + 1] = (b >> 16) as u16;
    }

    #[test]
    fn decode_record() {
        let mut w = vec![0u16; reg::LEN as usize];
        w[reg::VERSION as usize] = 1;
        w[reg::STATUS as usize] = status::VALID | status::TIP_CHECKED;
        w[reg::STICK_NO as usize] = 0x0002;
        w[reg::STICK_NO as usize + 1] = 0x0001; // 65538
        w[reg::PRODUCT_CODE as usize] = u16::from_le_bytes(*b"X2");
        w[reg::PRODUCT_CODE as usize + 1] = u16::from_le_bytes(*b"12");
        w[reg::PRODUCT_CODE as usize + 2] = u16::from_le_bytes(*b"PI");
        w[reg::OVERALL_RESULT as usize] = 2;
        w[reg::RECORD_SEQ as usize] = 7;
        put_real(&mut w, reg::BUTT + station::LOAD, 150.0);
        put_real(&mut w, reg::BUTT + station::point(1) + point::POSITION, 100.5);
        put_real(
            &mut w,
            reg::BUTT + station::point(4) + point::attempt(4) + attempt::BEND,
            -0.25,
        );
        w[(reg::TIP + station::RESULT) as usize] = 1;
        w[(reg::TIP + station::point(3) + point::DECIDE_ATTEMPT) as usize] = 3;

        let r = StickRecord::decode(&w).unwrap();
        assert_eq!(r.version, 1);
        assert!(r.status.valid && r.status.tip_checked);
        assert!(!r.status.butt_checked && !r.status.overall_ok);
        assert_eq!(r.stick_no, 65538);
        assert_eq!(r.product_code, "X212PI");
        assert_eq!(r.overall_result, 2);
        assert_eq!(r.record_seq, 7);
        assert_eq!(r.butt.load, 150.0);
        assert_eq!(r.butt.points.len(), 4);
        assert_eq!(r.butt.points[0].position, 100.5);
        assert_eq!(r.butt.points[3].attempts[3].bend, -0.25);
        assert_eq!(r.tip.result, 1);
        assert_eq!(r.tip.points[2].decide_attempt, 3);
        assert!(StickRecord::decode(&w[..239]).is_none());
    }
}
