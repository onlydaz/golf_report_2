//! Read queries over the tables of `migrations/0001_stick_records.sql`, used by the UI.
//! Every read query takes the same [`StickFilter`] anchored to `stick` (alias `s`).

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool, Postgres, QueryBuilder};

use crate::plc::record::StickRecord;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct StickFilter {
    /// Inclusive.
    pub from: Option<DateTime<Utc>>,
    /// Exclusive.
    pub to: Option<DateTime<Utc>>,
    pub product_code: Option<String>,
    pub stick_no: Option<i32>,
    /// Overall result: 0 not measured, 1 OK, 2 NG.
    pub result: Option<i16>,
    pub butt_result: Option<i16>,
    pub tip_result: Option<i16>,
}

pub(super) fn push_filter(qb: &mut QueryBuilder<Postgres>, f: &StickFilter) {
    qb.push(" WHERE TRUE");
    if let Some(v) = f.from {
        qb.push(" AND s.received_at >= ").push_bind(v);
    }
    if let Some(v) = f.to {
        qb.push(" AND s.received_at < ").push_bind(v);
    }
    if let Some(v) = &f.product_code {
        qb.push(" AND s.product_code = ").push_bind(v.clone());
    }
    if let Some(v) = f.stick_no {
        qb.push(" AND s.stick_no = ").push_bind(v);
    }
    if let Some(v) = f.result {
        qb.push(" AND s.overall_result = ").push_bind(v);
    }
    for (station, result) in [("BUTT", f.butt_result), ("TIP", f.tip_result)] {
        if let Some(v) = result {
            qb.push(" AND EXISTS (SELECT 1 FROM station_result sf WHERE sf.stick_id = s.id AND sf.station = ")
                .push_bind(station)
                .push(" AND sf.result = ").push_bind(v).push(")");
        }
    }
}

/// Station rows joined as `b` (BUTT) and `t` (TIP).
pub(super) const JOIN_STATIONS: &str = " FROM stick s \
    LEFT JOIN station_result b ON b.stick_id = s.id AND b.station = 'BUTT' \
    LEFT JOIN station_result t ON t.stick_id = s.id AND t.station = 'TIP'";

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StickStats {
    pub total: i64,
    pub ok: i64,
    pub ng: i64,
    pub butt_ok: i64,
    pub butt_ng: i64,
    pub tip_ok: i64,
    pub tip_ng: i64,
}

pub async fn stick_stats(pool: &PgPool, f: &StickFilter) -> Result<StickStats, sqlx::Error> {
    let mut qb = QueryBuilder::new(
        "SELECT count(*) AS total, \
         count(*) FILTER (WHERE s.overall_result = 1) AS ok, \
         count(*) FILTER (WHERE s.overall_result = 2) AS ng, \
         count(*) FILTER (WHERE b.result = 1) AS butt_ok, \
         count(*) FILTER (WHERE b.result = 2) AS butt_ng, \
         count(*) FILTER (WHERE t.result = 1) AS tip_ok, \
         count(*) FILTER (WHERE t.result = 2) AS tip_ng",
    );
    qb.push(JOIN_STATIONS);
    push_filter(&mut qb, f);
    qb.build_query_as().fetch_one(pool).await
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StickRow {
    pub id: i64,
    pub received_at: DateTime<Utc>,
    pub record_seq: i32,
    pub stick_no: i32,
    pub product_code: String,
    pub overall_result: i16,
    pub butt_result: Option<i16>,
    pub butt_load_g: Option<f32>,
    pub tip_result: Option<i16>,
    pub tip_load_g: Option<f32>,
    /// Bend (mm) of the deciding attempt, per point P1..P4; `None` if not measured.
    #[sqlx(skip)]
    pub butt_bends: [Option<f32>; 4],
    #[sqlx(skip)]
    pub tip_bends: [Option<f32>; 4],
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StickPage {
    pub items: Vec<StickRow>,
    pub total: i64,
}

/// Newest first. `page` starts at 1.
pub async fn stick_list(
    pool: &PgPool,
    f: &StickFilter,
    page: i64,
    page_size: i64,
) -> Result<StickPage, sqlx::Error> {
    let page_size = page_size.clamp(1, 500);
    let offset = (page.max(1) - 1) * page_size;

    let mut qb = QueryBuilder::new("SELECT count(*) FROM stick s");
    push_filter(&mut qb, f);
    let total: i64 = qb.build_query_scalar().fetch_one(pool).await?;

    let mut qb = QueryBuilder::new(
        "SELECT s.id, s.received_at, s.record_seq, s.stick_no, s.product_code, s.overall_result, \
         b.result AS butt_result, b.load_g AS butt_load_g, t.result AS tip_result, t.load_g AS tip_load_g",
    );
    qb.push(JOIN_STATIONS);
    push_filter(&mut qb, f);
    qb.push(" ORDER BY s.received_at DESC, s.id DESC LIMIT ")
        .push_bind(page_size)
        .push(" OFFSET ")
        .push_bind(offset);
    let mut items: Vec<StickRow> = qb.build_query_as().fetch_all(pool).await?;

    let ids: Vec<i64> = items.iter().map(|r| r.id).collect();
    let bends: Vec<(i64, String, i16, Option<f32>)> = sqlx::query_as(
        "SELECT stick_id, station, point_no, bend_mm FROM point_decided WHERE stick_id = ANY($1)",
    )
    .bind(&ids)
    .fetch_all(pool)
    .await?;
    let mut by_id: HashMap<i64, &mut StickRow> = items.iter_mut().map(|r| (r.id, r)).collect();
    for (id, station, point_no, bend) in bends {
        let Some(row) = by_id.get_mut(&id) else { continue };
        let Some(slot) = usize::try_from(point_no - 1).ok().filter(|&i| i < 4) else { continue };
        match station.as_str() {
            "BUTT" => row.butt_bends[slot] = bend,
            "TIP" => row.tip_bends[slot] = bend,
            _ => {}
        }
    }

    Ok(StickPage { items, total })
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SkuSummary {
    pub product_code: String,
    pub first_at: DateTime<Utc>,
    pub last_at: DateTime<Utc>,
    pub total: i64,
    pub ok: i64,
    pub ng: i64,
    pub butt_ng: i64,
    pub tip_ng: i64,
}

/// One row per product code, most recently run first.
pub async fn sku_summary(pool: &PgPool, f: &StickFilter) -> Result<Vec<SkuSummary>, sqlx::Error> {
    let mut qb = QueryBuilder::new(
        "SELECT s.product_code, min(s.received_at) AS first_at, max(s.received_at) AS last_at, \
         count(*) AS total, \
         count(*) FILTER (WHERE s.overall_result = 1) AS ok, \
         count(*) FILTER (WHERE s.overall_result = 2) AS ng, \
         count(*) FILTER (WHERE b.result = 2) AS butt_ng, \
         count(*) FILTER (WHERE t.result = 2) AS tip_ng",
    );
    qb.push(JOIN_STATIONS);
    push_filter(&mut qb, f);
    qb.push(" GROUP BY s.product_code ORDER BY max(s.received_at) DESC");
    qb.build_query_as().fetch_all(pool).await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StickDetail {
    pub id: i64,
    pub received_at: DateTime<Utc>,
    /// Decoded from the stored raw words with the same decoder as the live record.
    pub record: StickRecord,
}

pub async fn stick_detail(pool: &PgPool, id: i64) -> Result<Option<StickDetail>, sqlx::Error> {
    let row: Option<(i64, DateTime<Utc>, Vec<u8>)> =
        sqlx::query_as("SELECT id, received_at, raw_words FROM stick WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await?;
    Ok(row.and_then(|(id, received_at, raw)| {
        let words: Vec<u16> = raw.chunks_exact(2).map(|b| u16::from_le_bytes([b[0], b[1]])).collect();
        StickRecord::decode(&words).map(|record| StickDetail { id, received_at, record })
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::DbConfig;
    use crate::db::save_record;
    use crate::plc::registers::record::{self as reg, attempt, point, station};

    fn put_real(w: &mut [u16], o: u16, v: f32) {
        let b = v.to_bits();
        w[o as usize] = (b & 0xFFFF) as u16;
        w[o as usize + 1] = (b >> 16) as u16;
    }

    /// One stick: BUTT 4 points, TIP 1 point, P1 decided on attempt 2.
    fn record(seq: i32, stick_no: i32, code: &[u8; 2], butt: i16, tip: i16) -> StickRecord {
        let mut w = vec![0u16; reg::LEN as usize];
        w[reg::VERSION as usize] = 1;
        w[reg::RECORD_SEQ as usize] = seq as u16;
        w[reg::STICK_NO as usize] = stick_no as u16;
        w[reg::PRODUCT_CODE as usize] = u16::from_le_bytes(*code);
        w[reg::OVERALL_RESULT as usize] = if butt == 2 || tip == 2 { 2 } else { 1 } as u16;
        for (base, result, points) in [(reg::BUTT, butt, 4u16), (reg::TIP, tip, 1)] {
            w[(base + station::RESULT) as usize] = result as u16;
            w[(base + station::POINT_COUNT) as usize] = points;
            put_real(&mut w, base + station::LOAD, 2500.0);
            for n in 1..=points {
                let p = base + station::point(n);
                w[(p + point::RESULT) as usize] = 1;
                w[(p + point::ATTEMPT_COUNT) as usize] = 2;
                w[(p + point::DECIDE_ATTEMPT) as usize] = 2;
                put_real(&mut w, p + point::attempt(1) + attempt::BEND, 999.0);
                put_real(&mut w, p + point::attempt(2) + attempt::BEND, 100.0 + n as f32);
            }
        }
        StickRecord::decode(&w).unwrap()
    }

    /// Needs a Postgres server, see `store::tests`. Recreates `golf_report_query_test`.
    #[tokio::test]
    #[ignore]
    async fn filters_lists_and_details() {
        use sqlx::{Connection, Executor, PgConnection};
        let env = |k: &str| std::env::var(k).ok();
        let d = DbConfig::default();
        let cfg = DbConfig {
            host: env("TEST_PG_HOST").unwrap_or(d.host),
            port: env("TEST_PG_PORT").map(|p| p.parse().unwrap()).unwrap_or(d.port),
            user: env("TEST_PG_USER").unwrap_or(d.user),
            password: env("TEST_PG_PASSWORD").unwrap_or(d.password),
            dbname: "golf_report_query_test".into(),
            max_connections: 2,
        };
        let mut admin = PgConnection::connect_with(&super::super::options(&cfg, "postgres")).await.unwrap();
        admin.execute("DROP DATABASE IF EXISTS golf_report_query_test").await.unwrap();
        admin.close().await.unwrap();
        let pool = super::super::connect(&cfg).await.unwrap();

        let start = Utc::now();
        let a1 = save_record(&pool, &record(1, 10, b"AA", 1, 1)).await.unwrap();
        save_record(&pool, &record(2, 11, b"AA", 2, 1)).await.unwrap();
        let b1 = save_record(&pool, &record(3, 12, b"BB", 1, 2)).await.unwrap();

        let all = StickFilter::default();
        let s = stick_stats(&pool, &all).await.unwrap();
        assert_eq!((s.total, s.ok, s.ng), (3, 1, 2));
        assert_eq!((s.butt_ok, s.butt_ng, s.tip_ok, s.tip_ng), (2, 1, 2, 1));

        let aa = StickFilter { product_code: Some("AA".into()), ..Default::default() };
        assert_eq!(stick_stats(&pool, &aa).await.unwrap().total, 2);
        let ng = StickFilter { result: Some(2), ..Default::default() };
        assert_eq!(stick_stats(&pool, &ng).await.unwrap().total, 2);
        let no = StickFilter { stick_no: Some(12), ..Default::default() };
        assert_eq!(stick_stats(&pool, &no).await.unwrap().total, 1);
        let later = StickFilter { from: Some(Utc::now() + chrono::Duration::hours(1)), ..Default::default() };
        assert_eq!(stick_stats(&pool, &later).await.unwrap().total, 0);
        let before = StickFilter { to: Some(start - chrono::Duration::hours(1)), ..Default::default() };
        assert_eq!(stick_stats(&pool, &before).await.unwrap().total, 0);

        // Newest first, paged, with the deciding attempt's bend.
        let p = stick_list(&pool, &all, 1, 2).await.unwrap();
        assert_eq!(p.total, 3);
        assert_eq!(p.items.iter().map(|r| r.id).collect::<Vec<_>>()[0], b1);
        assert_eq!(p.items[0].butt_bends, [Some(101.0), Some(102.0), Some(103.0), Some(104.0)]);
        assert_eq!(p.items[0].tip_bends, [Some(101.0), None, None, None]);
        assert_eq!(p.items[0].butt_load_g, Some(2500.0));
        let p2 = stick_list(&pool, &all, 2, 2).await.unwrap();
        assert_eq!(p2.items.len(), 1);
        assert_eq!(p2.items[0].id, a1);

        let skus = sku_summary(&pool, &all).await.unwrap();
        assert_eq!(skus.iter().map(|s| s.product_code.as_str()).collect::<Vec<_>>(), ["BB", "AA"]);
        assert_eq!((skus[1].total, skus[1].ok, skus[1].ng, skus[1].butt_ng), (2, 1, 1, 1));

        let detail = stick_detail(&pool, b1).await.unwrap().unwrap();
        assert_eq!(detail.record.product_code, "BB");
        assert_eq!(detail.record.butt.points[3].attempts[1].bend, 104.0);
        assert!(stick_detail(&pool, -1).await.unwrap().is_none());
        pool.close().await;
    }
}
