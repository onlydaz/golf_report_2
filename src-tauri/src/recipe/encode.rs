//! X212PI_Recipe_RegisterMap.xlsx: Recipe D20020 + Quy uoc.
//! All offsets below are WORD offsets, not byte offsets.
use super::model::{Recipe, SaveRecipe, Station};

pub const RECIPE_BASE: u16 = 20020 + crate::plc::registers::MODBUS_OFFSET;
pub const WORD_COUNT: usize = 272;
const VERSION: u16 = 3;
const HEADER: usize = 16;
const STATION_SIZE: usize = 120;

pub fn encode(recipe: &Recipe) -> Result<[u16; WORD_COUNT], String> {
    if !recipe.summary.configured || recipe.summary.recipe_rev <= 0 {
        return Err("Công thức chưa được thiết lập và lưu hợp lệ.".into());
    }
    let mut validated = SaveRecipe {
        sku: recipe.summary.sku.clone(),
        recipe_rev: recipe.summary.recipe_rev,
        stations: recipe.stations.clone(),
    };
    validated.validate_and_normalize()?;
    let mut words = [0; WORD_COUNT]; // All reserved, disabled and unused slots stay zero.
    words[0] = VERSION;
    words[1] = WORD_COUNT as u16;
    // Same byte order as plc/decode.rs::ascii (ProductCode at D25024): low byte first.
    for (i, byte) in validated.sku.bytes().enumerate() {
        words[2 + i / 2] |= (byte as u16) << (8 * (i % 2));
    }
    put_u32(&mut words, 12, validated.recipe_rev as u32);
    put_station(&mut words, HEADER, &validated.stations.butt);
    put_station(&mut words, HEADER + STATION_SIZE, &validated.stations.tip);
    Ok(words)
}

fn put_u32(words: &mut [u16], offset: usize, bits: u32) {
    words[offset] = bits as u16;
    words[offset + 1] = (bits >> 16) as u16;
}

fn put_real(words: &mut [u16], offset: usize, value: f64) {
    put_u32(words, offset, (value as f32).to_bits());
}

fn put_station(words: &mut [u16], base: usize, station: &Station) {
    // Excel: Enable=0 skips every check in that station. Zero the whole station.
    if station.enabled != Some(1) {
        return;
    }
    words[base] = 1;
    words[base + 1] = station.num_points.unwrap() as u16;
    words[base + 2] = station.max_rot.unwrap() as u16;
    words[base + 3] = station.settle_time.unwrap() as u16; // Already in 100 ms units.
    put_real(words, base + 4, station.load_tol.unwrap()); // g, never kg.
    put_real(words, base + 6, station.bend_tol.unwrap());
    for (i, p) in station
        .points
        .iter()
        .take(words[base + 1] as usize)
        .enumerate()
    {
        // Excel: five arrays, each 10 REALs, with the same index for one position.
        for (offset, value) in [
            (12, p.pos_linear),
            (32, p.pos_press_fixed),
            (52, p.pos_force),
            (72, p.load),
            (92, p.bend),
        ] {
            put_real(words, base + offset + 2 * i, value.unwrap());
        }
    }
}

/// Recipe storage/encoding supports 10 points; the current result mapping supports only 4 per station.
pub fn check_result_capacity(recipe: &Recipe) -> Result<(), String> {
    let limit = crate::plc::registers::record::station::NUM_POINTS as i16;
    for (name, station) in [
        ("BUTT", &recipe.stations.butt),
        ("TIP", &recipe.stations.tip),
    ] {
        if station.enabled == Some(1) && station.num_points.is_some_and(|n| n > limit) {
            return Err(format!(
                "Chưa cho phép nạp: trạm {name} có hơn {limit} điểm, vượt mapping kết quả đo hiện tại. Cần kỹ thuật viên xác nhận mapping tương ứng."
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use crate::recipe::model::{Point, RecipeSummary, tests::valid_recipe};

    pub fn saved_recipe() -> Recipe {
        let input = valid_recipe();
        Recipe {
            summary: RecipeSummary {
                id: 1,
                customer: "TM".into(),
                sku: input.sku,
                recipe_rev: 0x12345678,
                updated_at: chrono::Utc::now(),
                configured: true,
            },
            stations: input.stations,
        }
    }

    #[test]
    fn workbook_addresses_word_order_units_and_all_ten_indexes() {
        let mut recipe = saved_recipe();
        recipe.summary.sku = "ABCDEFGHIJKLMNOPQRST".into();
        for (s, station) in [&mut recipe.stations.butt, &mut recipe.stations.tip]
            .into_iter()
            .enumerate()
        {
            *station = Station {
                enabled: Some(1),
                num_points: Some(10),
                max_rot: Some(3),
                settle_time: Some(17),
                load_tol: Some(12.5),
                bend_tol: Some(0.25),
                points: std::array::from_fn(|i| {
                    let v = (s * 100 + i) as f64;
                    Point {
                        pos_linear: Some(v - 0.5),
                        pos_press_fixed: Some(v + 10.25),
                        pos_force: Some(v + 20.5),
                        load: Some(v + 1000.75),
                        bend: Some(v + 40.125),
                    }
                }),
            };
        }
        let w = encode(&recipe).unwrap();
        assert_eq!(w.len(), 272);
        assert_eq!(&w[..2], &[3, 272]);
        assert_eq!(w[2], 0x4241);
        assert_eq!(w[11], 0x5453);
        assert_eq!(&w[12..16], &[0x5678, 0x1234, 0, 0]);
        // Literal workbook addresses, independent of encoder offset constants.
        for (station, base, arrays) in [
            (
                &recipe.stations.butt,
                20036,
                [20048, 20068, 20088, 20108, 20128],
            ),
            (
                &recipe.stations.tip,
                20156,
                [20168, 20188, 20208, 20228, 20248],
            ),
        ] {
            let offset = base - 20020;
            assert_eq!(
                &w[offset..offset + 4],
                &[1, station.num_points.unwrap() as u16, 3, 17]
            );
            assert_eq!(&w[offset + 4..offset + 8], &[0, 0x4148, 0, 0x3e80]);
            assert!(w[offset + 8..offset + 12].iter().all(|&v| v == 0));
            assert!(w[offset + 112..offset + 120].iter().all(|&v| v == 0));
            for (i, point) in station
                .points
                .iter()
                .take(station.num_points.unwrap() as usize)
                .enumerate()
            {
                for (addr, value) in arrays.into_iter().zip([
                    point.pos_linear,
                    point.pos_press_fixed,
                    point.pos_force,
                    point.load,
                    point.bend,
                ]) {
                    let o = addr - 20020 + 2 * i;
                    let got = f32::from_bits(u32::from(w[o]) | (u32::from(w[o + 1]) << 16));
                    assert_eq!(got, value.unwrap() as f32, "D{} index {}", addr + 2 * i, i);
                }
            }
        }
        assert!(w[256..].iter().all(|&v| v == 0));
        assert!(check_result_capacity(&recipe).is_err());
    }

    #[test]
    fn unused_disabled_and_padding_are_zero_without_mutating_saved_values() {
        let mut recipe = saved_recipe();
        recipe.stations.butt.points[9] = recipe.stations.butt.points[0].clone();
        recipe.stations.tip.points[0] = recipe.stations.butt.points[0].clone();
        let w = encode(&recipe).unwrap();
        assert_eq!(w[5], b'R' as u16);
        assert!(w[6..12].iter().all(|&v| v == 0));
        for (count, starts) in [
            (4, [20048, 20068, 20088, 20108, 20128]),
            (1, [20168, 20188, 20208, 20228, 20248]),
        ] {
            for start in starts {
                assert!(
                    w[start - 20020 + 2 * count..start - 20020 + 20]
                        .iter()
                        .all(|&v| v == 0)
                );
            }
        }
        assert_eq!(&w[136..138], &[1, 1]);
        assert!(w[256..].iter().all(|&v| v == 0));
        assert!(check_result_capacity(&recipe).is_ok());
        assert!(recipe.stations.butt.points[9].load.is_some());
        recipe.stations.tip.enabled = Some(0);
        recipe.stations.tip.num_points = Some(10);
        let disabled = encode(&recipe).unwrap();
        assert!(disabled[136..256].iter().all(|&v| v == 0));
        assert!(recipe.stations.tip.points[0].load.is_some());
        assert!(check_result_capacity(&recipe).is_ok());
        recipe.stations.butt.points[0].bend = Some(f64::NAN);
        assert!(encode(&recipe).is_err());
        recipe = saved_recipe();
        recipe.summary.configured = false;
        assert!(encode(&recipe).is_err());
        recipe = saved_recipe();
        recipe.stations.butt.num_points = Some(5);
        assert!(encode(&recipe).is_err());
        recipe = saved_recipe();
        recipe.stations.tip.enabled = Some(1);
        recipe.stations.tip.num_points = Some(2);
        assert!(encode(&recipe).is_err());
    }
}
