//! Insert one decoded PLC record into the tables of `migrations/0001_stick_records.sql`.

use sqlx::{PgPool, Postgres, Transaction};

use crate::plc::record::{Station, StickRecord};

/// Save `r` in one transaction. Returns the new `stick.id`.
pub async fn save_record(pool: &PgPool, r: &StickRecord) -> Result<i64, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let raw: Vec<u8> = r.raw.iter().flat_map(|w| w.to_le_bytes()).collect();
    let (id,): (i64,) = sqlx::query_as(
        "INSERT INTO stick (record_seq, stick_no, product_code, format_version, \
                            status_raw, overall_result, raw_words) \
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
    )
    .bind(r.record_seq)
    .bind(r.stick_no)
    .bind(&r.product_code)
    .bind(r.version)
    .bind(i32::from(r.status.raw))
    .bind(r.overall_result)
    .bind(raw)
    .fetch_one(&mut *tx)
    .await?;

    insert_station(&mut tx, id, "BUTT", &r.butt).await?;
    insert_station(&mut tx, id, "TIP", &r.tip).await?;

    tx.commit().await?;
    Ok(id)
}

/// Number of leading items to keep for a count read from the PLC.
fn measured(count: i16) -> usize {
    count.clamp(0, 4) as usize
}

async fn insert_station(
    tx: &mut Transaction<'_, Postgres>,
    id: i64,
    name: &str,
    s: &Station,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO station_result (stick_id, station, result, point_count, ng_point, load_g) \
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(id)
    .bind(name)
    .bind(s.result)
    .bind(s.point_count)
    .bind(s.ng_point)
    .bind(s.load)
    .execute(&mut **tx)
    .await?;

    for (p_no, p) in (1i16..).zip(s.points.iter().take(measured(s.point_count))) {
        sqlx::query(
            "INSERT INTO point_result (stick_id, station, point_no, result, attempt_count, \
                                       decide_attempt, position_mm) \
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(id)
        .bind(name)
        .bind(p_no)
        .bind(p.result)
        .bind(p.attempt_count)
        .bind(p.decide_attempt)
        .bind(p.position)
        .execute(&mut **tx)
        .await?;

        for (a_no, a) in (1i16..).zip(p.attempts.iter().take(measured(p.attempt_count))) {
            sqlx::query(
                "INSERT INTO attempt (stick_id, station, point_no, attempt_no, push_dist_mm, bend_mm) \
                 VALUES ($1, $2, $3, $4, $5, $6)",
            )
            .bind(id)
            .bind(name)
            .bind(p_no)
            .bind(a_no)
            .bind(a.push_dist)
            .bind(a.bend)
            .execute(&mut **tx)
            .await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::DbConfig;
    use crate::plc::registers::record::{self as reg, point, station};

    /// Needs a Postgres server: `cargo test -- --ignored`, server from env
    /// `TEST_PG_HOST`, `TEST_PG_PORT`, `TEST_PG_USER`, `TEST_PG_PASSWORD` (defaults: DbConfig).
    /// Drops and recreates the database `golf_report_test`.
    #[tokio::test]
    #[ignore]
    async fn creates_db_and_saves_record() {
        use sqlx::{Connection, Executor, PgConnection};
        let env = |k: &str| std::env::var(k).ok();
        let d = DbConfig::default();
        let cfg = DbConfig {
            host: env("TEST_PG_HOST").unwrap_or(d.host),
            port: env("TEST_PG_PORT").map(|p| p.parse().unwrap()).unwrap_or(d.port),
            user: env("TEST_PG_USER").unwrap_or(d.user),
            password: env("TEST_PG_PASSWORD").unwrap_or(d.password),
            dbname: "golf_report_test".into(),
            max_connections: 2,
        };
        let mut admin = PgConnection::connect_with(&super::super::options(&cfg, "postgres")).await.unwrap();
        admin.execute("DROP DATABASE IF EXISTS golf_report_test").await.unwrap();
        admin.close().await.unwrap();

        let pool = super::super::connect(&cfg).await.unwrap();

        let mut w = vec![0u16; reg::LEN as usize];
        w[reg::VERSION as usize] = 1;
        w[reg::RECORD_SEQ as usize] = 7;
        w[(reg::BUTT + station::POINT_COUNT) as usize] = 2;
        w[(reg::BUTT + station::point(1) + point::ATTEMPT_COUNT) as usize] = 3;
        w[(reg::BUTT + station::point(2) + point::ATTEMPT_COUNT) as usize] = 1;
        w[(reg::TIP + station::POINT_COUNT) as usize] = 9; // out of range -> clamped to 4
        let r = StickRecord::decode(&w).unwrap();

        let id = save_record(&pool, &r).await.unwrap();
        let count = |sql: &'static str| {
            let pool = pool.clone();
            async move { sqlx::query_scalar::<_, i64>(sql).bind(id).fetch_one(&pool).await.unwrap() }
        };
        assert_eq!(count("SELECT count(*) FROM stick WHERE id = $1").await, 1);
        assert_eq!(count("SELECT count(*) FROM station_result WHERE stick_id = $1").await, 2);
        assert_eq!(count("SELECT count(*) FROM point_result WHERE stick_id = $1").await, 2 + 4);
        assert_eq!(count("SELECT count(*) FROM attempt WHERE stick_id = $1").await, 3 + 1);
        assert_eq!(
            count("SELECT octet_length(raw_words)::bigint FROM stick WHERE id = $1").await,
            480
        );
        pool.close().await;

        // Second startup on an existing database is a no-op.
        super::super::connect(&cfg).await.unwrap().close().await;
    }
}
