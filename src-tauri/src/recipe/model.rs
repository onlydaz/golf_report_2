use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Point {
    pub pos_linear: Option<f64>,
    pub pos_press_fixed: Option<f64>,
    pub pos_force: Option<f64>,
    pub load: Option<f64>,
    pub bend: Option<f64>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Station {
    pub enabled: Option<i16>,
    pub num_points: Option<i16>,
    pub max_rot: Option<i16>,
    pub settle_time: Option<i16>,
    pub load_tol: Option<f64>,
    pub bend_tol: Option<f64>,
    // Fixed length preserves the five values together at each PLC index 0..9.
    pub points: [Point; 10],
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Stations {
    pub butt: Station,
    pub tip: Station,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RecipeSummary {
    pub id: i64,
    pub customer: String,
    pub sku: String,
    pub recipe_rev: i32,
    pub updated_at: DateTime<Utc>,
    pub configured: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recipe {
    #[serde(flatten)]
    pub summary: RecipeSummary,
    pub stations: Stations,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveRecipe {
    pub sku: String,
    pub recipe_rev: i32,
    pub stations: Stations,
}

pub fn validate_sku(sku: &str) -> Result<(), String> {
    if sku.trim().is_empty() || sku.len() > 20 || !sku.is_ascii() || sku.contains('\0') {
        return Err("SKU phải có 1–20 ký tự ASCII, không chứa ký tự NUL.".into());
    }
    Ok(())
}

// REAL is IEEE-754 binary32 in the workbook. This is a representation limit,
// not an assumed machine travel/load limit. Preserve entered precision in DB.
fn finite(value: Option<f64>) -> bool {
    value.is_none_or(|v| v.is_finite() && (v as f32).is_finite())
}

fn validate_station(s: &mut Station, name: &str) -> Result<(), String> {
    if !finite(s.load_tol)
        || !finite(s.bend_tol)
        || s.points.iter().any(|p| {
            [p.pos_linear, p.pos_press_fixed, p.pos_force, p.load, p.bend]
                .into_iter()
                .any(|v| !finite(v))
        })
    {
        return Err(format!(
            "{name}: thông số phải là số hữu hạn biểu diễn được bằng REAL 32 bit."
        ));
    }
    match s.enabled {
        Some(0) => {
            // Excel: Enable=0 skips station checks. Never retain stale settings
            // as usable data when an operator disables a station.
            *s = Station {
                enabled: Some(0),
                ..Station::default()
            };
            return Ok(());
        }
        Some(1) => {}
        _ => return Err(format!("{name}: chọn sử dụng trạm (0 hoặc 1).")),
    }
    let count = s
        .num_points
        .filter(|v| (1..=10).contains(v))
        .ok_or_else(|| format!("{name}: số điểm đo phải từ 1 đến 10."))?;
    if !s.max_rot.is_some_and(|v| (0..=3).contains(&v)) {
        return Err(format!("{name}: số lần xoay tối đa phải từ 0 đến 3."));
    }
    if !s.settle_time.is_some_and(|v| v >= 0) {
        return Err(format!(
            "{name}: thời gian ổn định phải từ 0 đến 32767, đơn vị 100 ms."
        ));
    }
    if !s.load_tol.is_some_and(|v| v >= 0.0) || !s.bend_tol.is_some_and(|v| v >= 0.0) {
        return Err(format!("{name}: nhập đủ hai dung sai không âm."));
    }
    for (i, p) in s.points.iter_mut().enumerate() {
        if i >= count as usize {
            *p = Point::default();
            continue;
        }
        if p.pos_linear.is_none() || p.pos_press_fixed.is_none() || p.pos_force.is_none() {
            return Err(format!("{name} · P{}: nhập đủ ba vị trí (mm).", i + 1));
        }
        if !p.load.is_some_and(|v| v > 0.0 && (v as f32) > 0.0)
            || !p.bend.is_some_and(|v| v > 0.0 && (v as f32) > 0.0)
        {
            return Err(format!(
                "{name} · P{}: lực đè và độ cong phải lớn hơn 0 (REAL 32 bit).",
                i + 1
            ));
        }
    }
    Ok(())
}

impl SaveRecipe {
    pub fn validate_and_normalize(&mut self) -> Result<(), String> {
        validate_sku(&self.sku)?;
        if self.recipe_rev < 0 {
            return Err("Phiên bản công thức không hợp lệ.".into());
        }
        validate_station(&mut self.stations.butt, "BUTT")?;
        validate_station(&mut self.stations.tip, "TIP")
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn valid_recipe() -> SaveRecipe {
        let mut butt = Station {
            enabled: Some(1),
            num_points: Some(1),
            max_rot: Some(0),
            settle_time: Some(0),
            load_tol: Some(0.0),
            bend_tol: Some(0.0),
            ..Station::default()
        };
        butt.points[0] = Point {
            pos_linear: Some(0.0),
            pos_press_fixed: Some(-1.0),
            pos_force: Some(0.0),
            load: Some(100.0),
            bend: Some(1.0),
        };
        SaveRecipe {
            sku: "MH1253R".into(),
            recipe_rev: 0,
            stations: Stations {
                butt,
                tip: Station {
                    enabled: Some(0),
                    ..Station::default()
                },
            },
        }
    }

    #[test]
    fn unset_is_not_zero_and_disabled_station_skips_ranges() {
        let mut r = valid_recipe();
        assert!(r.validate_and_normalize().is_ok());
        r.stations.butt.max_rot = None;
        assert!(r.validate_and_normalize().is_err());
        r.stations.butt.enabled = Some(0);
        r.stations.butt.num_points = Some(-1);
        assert!(r.validate_and_normalize().is_ok());
        assert_eq!(
            r.stations.butt,
            Station {
                enabled: Some(0),
                ..Station::default()
            }
        );
        r.stations.butt.enabled = None;
        assert!(r.validate_and_normalize().is_err());
        r.stations.butt.enabled = Some(2);
        assert!(r.validate_and_normalize().is_err());
    }

    #[test]
    fn point_sets_keep_indexes_and_clear_unused_data() {
        let mut r = valid_recipe();
        r.stations.butt.num_points = Some(10);
        for (i, p) in r.stations.butt.points.iter_mut().enumerate() {
            *p = Point {
                pos_linear: Some(i as f64),
                pos_press_fixed: Some(i as f64 + 10.0),
                pos_force: Some(i as f64 + 20.0),
                load: Some(i as f64 + 30.0),
                bend: Some(i as f64 + 40.0),
            };
        }
        assert!(r.validate_and_normalize().is_ok());
        assert_eq!(r.stations.butt.points[9].pos_force, Some(29.0));
        r.stations.butt.num_points = Some(1);
        assert!(r.validate_and_normalize().is_ok());
        assert_eq!(r.stations.butt.points[0].load, Some(30.0));
        assert!(
            r.stations.butt.points[1..]
                .iter()
                .all(|p| *p == Point::default())
        );
    }

    #[test]
    fn rejects_invalid_ranges_missing_values_and_nonfinite_numbers() {
        for count in [0, 11] {
            let mut r = valid_recipe();
            r.stations.butt.num_points = Some(count);
            assert!(r.validate_and_normalize().is_err());
        }
        for rot in [-1, 4] {
            let mut r = valid_recipe();
            r.stations.butt.max_rot = Some(rot);
            assert!(r.validate_and_normalize().is_err());
        }
        let mut r = valid_recipe();
        r.stations.butt.settle_time = Some(-1);
        assert!(r.validate_and_normalize().is_err());
        for value in [
            None,
            Some(0.0),
            Some(-1.0),
            Some(f64::NAN),
            Some(f64::INFINITY),
            Some(1e40),
            Some(1e-100),
        ] {
            let mut r = valid_recipe();
            r.stations.butt.points[0].load = value;
            assert!(r.validate_and_normalize().is_err());
            let mut r = valid_recipe();
            r.stations.butt.points[0].bend = value;
            assert!(r.validate_and_normalize().is_err());
        }
        let mut r = valid_recipe();
        r.stations.butt.points[0].pos_force = None;
        assert!(r.validate_and_normalize().is_err());
        let mut r = valid_recipe();
        r.stations.butt.load_tol = Some(-1.0);
        assert!(r.validate_and_normalize().is_err());
        let mut r = valid_recipe();
        r.stations.tip.points[9].load = Some(f64::NAN);
        assert!(r.validate_and_normalize().is_err());
    }

    #[test]
    fn validates_sku_and_exact_point_shape() {
        for sku in ["", " ", "MÃ", "ABCDEFGHIJKLMNOPQRSTU", "A\0B"] {
            assert!(validate_sku(sku).is_err());
        }
        assert!(validate_sku("ABCDEFGHIJKLMNOPQRST").is_ok());
        let mut value = serde_json::to_value(valid_recipe().stations.butt).unwrap();
        value["points"].as_array_mut().unwrap().pop();
        assert!(serde_json::from_value::<Station>(value).is_err());
    }
}
