//! Read-only report aggregation and bounded Excel batches. No raw PLC payloads.
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool, Postgres, QueryBuilder};

use super::query::{JOIN_STATIONS, StickFilter, StickRow, StickStats, push_filter};
use crate::config::StationSettings;

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DailyCount {
    day: String,
    total: i64,
    ok: i64,
    ng: i64,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct HalfHourCount {
    slot: String,
    total: i64,
    ok: i64,
    ng: i64,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PointSummary {
    station: String,
    point_no: i16,
    position_min: Option<f64>,
    position_max: Option<f64>,
    load_g: Option<f64>,
    push_dist_mm: Option<f64>,
    bend_mm: Option<f64>,
    samples: i64,
    points: i64,
    ok: i64,
    ng: i64,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct HistogramBin {
    point_no: i16,
    bucket: i32,
    count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSummary {
    stats: StickStats,
    retested: i64,
    daily: Vec<DailyCount>,
    half_hour: Vec<HalfHourCount>,
    points: Vec<PointSummary>,
    histogram: Vec<HistogramBin>,
    histogram_limits: Option<[f64; 2]>,
    bend_distribution: Vec<BendDistribution>,
    invalid_attempts: i64,
    generated_at: DateTime<Utc>,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct BendDistribution {
    /// 0 aggregates all BUTT points; 1..4 select an individual point.
    point_no: i16,
    count: i64,
    mean: Option<f64>,
    sample_std_dev: Option<f64>,
}

pub async fn summary(
    pool: &PgPool,
    f: &StickFilter,
    timezone: &str,
    settings: &StationSettings,
) -> Result<ReportSummary, sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        .execute(&mut *tx)
        .await?;
    let mut qb = QueryBuilder::new(
        "SELECT count(*) AS total, count(*) FILTER (WHERE s.overall_result = 1) AS ok, \
         count(*) FILTER (WHERE s.overall_result = 2) AS ng, \
         count(*) FILTER (WHERE b.result = 1) AS butt_ok, count(*) FILTER (WHERE b.result = 2) AS butt_ng, \
         count(*) FILTER (WHERE t.result = 1) AS tip_ok, count(*) FILTER (WHERE t.result = 2) AS tip_ng",
    );
    qb.push(JOIN_STATIONS);
    push_filter(&mut qb, f);
    let stats = qb.build_query_as().fetch_one(&mut *tx).await?;

    let mut qb = QueryBuilder::new("SELECT count(*) FROM stick s");
    push_filter(&mut qb, f);
    qb.push(" AND EXISTS (SELECT 1 FROM point_result p WHERE p.stick_id = s.id AND p.attempt_count >= 2)");
    let retested = qb.build_query_scalar().fetch_one(&mut *tx).await?;

    let mut qb = QueryBuilder::<Postgres>::new("SELECT to_char(s.received_at AT TIME ZONE ");
    qb.push_bind(timezone).push(
        ", 'YYYY-MM-DD') AS day, count(*) AS total, \
        count(*) FILTER (WHERE s.overall_result = 1) AS ok, \
        count(*) FILTER (WHERE s.overall_result = 2) AS ng FROM stick s",
    );
    push_filter(&mut qb, f);
    qb.push(" GROUP BY day ORDER BY day");
    let daily = qb.build_query_as().fetch_all(&mut *tx).await?;

    let mut half_hour = Vec::new();
    if matches!((f.from, f.to), (Some(from), Some(to)) if to > from && (to - from).num_hours() <= 25) {
        let mut qb = QueryBuilder::<Postgres>::new("SELECT to_char(date_trunc('hour', s.received_at AT TIME ZONE ");
        qb.push_bind(timezone).push(") + floor(extract(minute from s.received_at AT TIME ZONE ")
            .push_bind(timezone).push(") / 30) * interval '30 minutes', 'YYYY-MM-DD HH24:MI') AS slot, count(*) AS total, \
             count(*) FILTER (WHERE s.overall_result = 1) AS ok, \
             count(*) FILTER (WHERE s.overall_result = 2) AS ng FROM stick s");
        push_filter(&mut qb, f);
        qb.push(" GROUP BY slot ORDER BY slot");
        half_hour = qb.build_query_as().fetch_all(&mut *tx).await?;
    }

    // One row per point, left joined to exactly its deciding attempt. Counts never fan out.
    // Averages ignore non-finite values, not zero; load is sampled only when a decision exists.
    let mut qb = QueryBuilder::new(
        "SELECT p.station, p.point_no, \
         min(p.position_mm::float8) FILTER (WHERE p.position_mm > '-Infinity'::real AND p.position_mm < 'Infinity'::real) AS position_min, \
         max(p.position_mm::float8) FILTER (WHERE p.position_mm > '-Infinity'::real AND p.position_mm < 'Infinity'::real) AS position_max, \
         avg(r.load_g::float8) FILTER (WHERE a.attempt_no IS NOT NULL AND r.load_g > '-Infinity'::real AND r.load_g < 'Infinity'::real) AS load_g, \
         avg(a.push_dist_mm::float8) FILTER (WHERE a.push_dist_mm > '-Infinity'::real AND a.push_dist_mm < 'Infinity'::real) AS push_dist_mm, \
         avg(a.bend_mm::float8) FILTER (WHERE a.bend_mm > '-Infinity'::real AND a.bend_mm < 'Infinity'::real) AS bend_mm, \
         count(a.attempt_no) AS samples, count(*) AS points, \
         count(*) FILTER (WHERE p.result = 1) AS ok, count(*) FILTER (WHERE p.result = 2) AS ng \
         FROM stick s JOIN point_result p ON p.stick_id = s.id \
         JOIN station_result r ON r.stick_id = p.stick_id AND r.station = p.station \
         LEFT JOIN attempt a ON a.stick_id = p.stick_id AND a.station = p.station \
             AND a.point_no = p.point_no AND a.attempt_no = p.decide_attempt",
    );
    push_filter(&mut qb, f);
    qb.push(" GROUP BY p.station, p.point_no ORDER BY p.station, p.point_no");
    let points = qb.build_query_as().fetch_all(&mut *tx).await?;

    // Use actual attempts, including retries, rather than histogram bin midpoints.
    // GROUPING SETS computes the pooled sample deviation directly (not an average of deviations).
    let mut qb = QueryBuilder::new(
        "SELECT COALESCE(a.point_no, 0)::int2 AS point_no, count(*) AS count, \
         avg(a.bend_mm::float8) AS mean, stddev_samp(a.bend_mm::float8) AS sample_std_dev \
         FROM stick s JOIN point_result p ON p.stick_id = s.id \
         JOIN station_result r ON r.stick_id = p.stick_id AND r.station = p.station \
         JOIN attempt a ON a.stick_id = p.stick_id AND a.station = p.station AND a.point_no = p.point_no",
    );
    push_filter(&mut qb, f);
    qb.push(" AND a.station = 'BUTT' AND a.bend_mm > '-Infinity'::real AND a.bend_mm < 'Infinity'::real \
             GROUP BY GROUPING SETS ((), (a.point_no)) ORDER BY point_no");
    let bend_distribution = qb.build_query_as().fetch_all(&mut *tx).await?;

    let histogram_limits = match (settings.bend_min_mm, settings.bend_max_mm) {
        (Some(lo), Some(hi)) if lo.is_finite() && hi.is_finite() && lo < hi => {
            Some([lo as f64, hi as f64])
        }
        _ => None,
    };
    let mut histogram = Vec::new();
    if let Some([lo, hi]) = histogram_limits {
        // 0 below, 1..12 within limits, 13 above. Both limits are inclusive.
        let mut qb = QueryBuilder::new("SELECT a.point_no, CASE WHEN a.bend_mm < ");
        qb.push_bind(lo).push(" THEN 0 WHEN a.bend_mm > ").push_bind(hi)
            .push(" THEN 13 ELSE LEAST(12, width_bucket(a.bend_mm::float8, ")
            .push_bind(lo).push(", ").push_bind(hi).push(", 12)) END AS bucket, count(*) AS count \
             FROM stick s JOIN point_result p ON p.stick_id = s.id \
             JOIN station_result r ON r.stick_id = p.stick_id AND r.station = p.station \
             JOIN attempt a ON a.stick_id = p.stick_id AND a.station = p.station AND a.point_no = p.point_no");
        push_filter(&mut qb, f);
        qb.push(" AND a.station = 'BUTT' AND a.bend_mm > '-Infinity'::real AND a.bend_mm < 'Infinity'::real \
                 GROUP BY a.point_no, bucket ORDER BY a.point_no, bucket");
        histogram = qb.build_query_as().fetch_all(&mut *tx).await?;
    }
    let mut qb =
        QueryBuilder::new("SELECT count(*) FROM stick s JOIN attempt a ON a.stick_id = s.id");
    push_filter(&mut qb, f);
    qb.push(" AND a.station = 'BUTT' AND NOT (a.bend_mm > '-Infinity'::real AND a.bend_mm < 'Infinity'::real)");
    let invalid_attempts = qb.build_query_scalar().fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok(ReportSummary {
        stats,
        retested,
        daily,
        half_hour,
        points,
        histogram,
        histogram_limits,
        bend_distribution,
        invalid_attempts,
        generated_at: Utc::now(),
    })
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ExportPoint {
    stick_id: i64,
    product_code: String,
    stick_no: i32,
    station: String,
    point_no: i16,
    position_mm: Option<f32>,
    result: i16,
    attempt_count: i16,
    decide_attempt: i16,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ExportAttempt {
    stick_id: i64,
    product_code: String,
    stick_no: i32,
    station: String,
    point_no: i16,
    attempt_no: i16,
    push_dist_mm: Option<f32>,
    bend_mm: Option<f32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportBatch {
    max_id: i64,
    next_id: Option<i64>,
    sticks: Vec<StickRow>,
    points: Vec<ExportPoint>,
    attempts: Vec<ExportAttempt>,
}

/// Keyset pages, at most 250 sticks / 8,000 attempts per command. The first call
/// fixes the upper id, so auto collection cannot make the export run indefinitely.
pub async fn export_batch(
    pool: &PgPool,
    f: &StickFilter,
    after_id: i64,
    max_id: Option<i64>,
) -> Result<ExportBatch, sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        .execute(&mut *tx)
        .await?;
    let max_id = if let Some(id) = max_id {
        id
    } else {
        let mut qb = QueryBuilder::new("SELECT COALESCE(max(s.id), 0) FROM stick s");
        push_filter(&mut qb, f);
        qb.build_query_scalar().fetch_one(&mut *tx).await?
    };
    let mut qb = QueryBuilder::new(
        "SELECT s.id, s.received_at, s.record_seq, s.stick_no, s.product_code, s.overall_result, \
         b.result AS butt_result, b.load_g AS butt_load_g, t.result AS tip_result, t.load_g AS tip_load_g",
    );
    qb.push(JOIN_STATIONS);
    push_filter(&mut qb, f);
    qb.push(" AND s.id > ")
        .push_bind(after_id)
        .push(" AND s.id <= ")
        .push_bind(max_id)
        .push(" ORDER BY s.id LIMIT 250");
    let sticks: Vec<StickRow> = qb.build_query_as().fetch_all(&mut *tx).await?;
    let ids: Vec<i64> = sticks.iter().map(|s| s.id).collect();
    let points = sqlx::query_as(
        "SELECT p.stick_id, s.product_code, s.stick_no, p.station, p.point_no, p.position_mm, \
         p.result, p.attempt_count, p.decide_attempt FROM point_result p JOIN stick s ON s.id = p.stick_id \
         WHERE p.stick_id = ANY($1) ORDER BY p.stick_id, p.station, p.point_no")
        .bind(&ids).fetch_all(&mut *tx).await?;
    let attempts = sqlx::query_as(
        "SELECT a.stick_id, s.product_code, s.stick_no, a.station, a.point_no, a.attempt_no, a.push_dist_mm, a.bend_mm \
         FROM attempt a JOIN stick s ON s.id = a.stick_id WHERE a.stick_id = ANY($1) \
         ORDER BY a.stick_id, a.station, a.point_no, a.attempt_no")
        .bind(&ids).fetch_all(&mut *tx).await?;
    let next_id = if sticks.len() == 250 {
        ids.last().copied()
    } else {
        None
    };
    tx.commit().await?;
    Ok(ExportBatch {
        max_id,
        next_id,
        sticks,
        points,
        attempts,
    })
}
