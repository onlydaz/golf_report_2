use sqlx::{PgConnection, PgPool};

use super::model::{Recipe, RecipeSummary, SaveRecipe, Station, Stations, validate_sku};

fn db_error(e: impl std::fmt::Display) -> String {
    format!("Lỗi cơ sở dữ liệu công thức: {e}")
}

#[derive(sqlx::FromRow)]
struct StationRow {
    station: String,
    enabled: Option<i16>,
    num_points: Option<i16>,
    max_rot: Option<i16>,
    settle_time: Option<i16>,
    load_tol: Option<f64>,
    bend_tol: Option<f64>,
    points: String,
}

pub async fn list(pool: &PgPool) -> Result<Vec<RecipeSummary>, String> {
    sqlx::query_as::<_, RecipeSummary>(
        "SELECT id, customer, sku, recipe_rev, updated_at, recipe_rev > 0 AS configured
         FROM recipes ORDER BY customer DESC, sku",
    )
    .fetch_all(pool)
    .await
    .map_err(db_error)
}

// The parent lock keeps metadata and both stations at the same revision.
async fn load(conn: &mut PgConnection, sku: &str, for_save: bool) -> Result<Recipe, String> {
    let sql = if for_save {
        "SELECT id, customer, sku, recipe_rev, updated_at, recipe_rev > 0 AS configured
         FROM recipes WHERE sku = $1 FOR UPDATE"
    } else {
        "SELECT id, customer, sku, recipe_rev, updated_at, recipe_rev > 0 AS configured
         FROM recipes WHERE sku = $1 FOR SHARE"
    };
    let summary = sqlx::query_as::<_, RecipeSummary>(sql)
        .bind(sku)
        .fetch_optional(&mut *conn)
        .await
        .map_err(db_error)?
        .ok_or("Không tìm thấy mã hàng trong danh sách công thức.")?;
    let rows = sqlx::query_as::<_, StationRow>(
        "SELECT station, enabled, num_points, max_rot, settle_time, load_tol, bend_tol,
                points::text AS points FROM recipe_stations WHERE recipe_id = $1 ORDER BY station",
    )
    .bind(summary.id)
    .fetch_all(&mut *conn)
    .await
    .map_err(db_error)?;
    if rows.len() != 2 {
        return Err("Công thức thiếu trạm BUTT hoặc TIP.".into());
    }
    let mut stations = Stations::default();
    for row in rows {
        let station = Station {
            enabled: row.enabled,
            num_points: row.num_points,
            max_rot: row.max_rot,
            settle_time: row.settle_time,
            load_tol: row.load_tol,
            bend_tol: row.bend_tol,
            points: serde_json::from_str(&row.points).map_err(db_error)?,
        };
        match row.station.as_str() {
            "BUTT" => stations.butt = station,
            "TIP" => stations.tip = station,
            _ => return Err("Tên trạm công thức không hợp lệ.".into()),
        }
    }
    Ok(Recipe { summary, stations })
}

pub async fn get(pool: &PgPool, sku: &str) -> Result<Recipe, String> {
    validate_sku(sku)?;
    let mut tx = pool.begin().await.map_err(db_error)?;
    let recipe = load(&mut tx, sku, false).await?;
    tx.commit().await.map_err(db_error)?;
    Ok(recipe)
}

pub async fn save(pool: &PgPool, mut input: SaveRecipe) -> Result<Recipe, String> {
    input.validate_and_normalize()?;
    let mut tx = pool.begin().await.map_err(db_error)?;
    let mut current = load(&mut tx, &input.sku, true).await?;
    if current.summary.recipe_rev != input.recipe_rev {
        return Err("Công thức đã được thay đổi ở phiên khác. Hãy tải lại trước khi lưu.".into());
    }
    if current.stations != input.stations {
        if current.summary.recipe_rev == i32::MAX {
            return Err("Phiên bản công thức đã đạt giới hạn DINT.".into());
        }
        for (name, station) in [("BUTT", &input.stations.butt), ("TIP", &input.stations.tip)] {
            let points = serde_json::to_string(&station.points).map_err(db_error)?;
            sqlx::query(
                "UPDATE recipe_stations SET enabled = $3, num_points = $4, max_rot = $5,
                 settle_time = $6, load_tol = $7, bend_tol = $8, points = $9::jsonb
                 WHERE recipe_id = $1 AND station = $2",
            )
            .bind(current.summary.id)
            .bind(name)
            .bind(station.enabled)
            .bind(station.num_points)
            .bind(station.max_rot)
            .bind(station.settle_time)
            .bind(station.load_tol)
            .bind(station.bend_tol)
            .bind(points)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        }
        current.summary = sqlx::query_as::<_, RecipeSummary>(
            "UPDATE recipes SET recipe_rev = recipe_rev + 1, updated_at = clock_timestamp()
             WHERE id = $1 RETURNING id, customer, sku, recipe_rev, updated_at, recipe_rev > 0 AS configured"
        ).bind(current.summary.id).fetch_one(&mut *tx).await.map_err(db_error)?;
        current.stations = input.stations;
    }
    tx.commit().await.map_err(db_error)?;
    Ok(current)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recipe::model::{Point, tests::valid_recipe};
    use sqlx::{
        AssertSqlSafe, Connection, Executor,
        postgres::{PgConnectOptions, PgPoolOptions},
    };

    /// Explicitly opt in. Uses only loopback PostgreSQL, a unique disposable schema
    /// in `postgres`, and never starts the app, writer, actor or poller.
    #[tokio::test]
    #[ignore = "requires local PostgreSQL; creates and drops an isolated recipe_test_* schema"]
    async fn postgres_recipe_roundtrip() {
        let cfg = crate::config::AppConfig::load().database;
        assert!(
            ["localhost", "127.0.0.1", "::1"].contains(&cfg.host.as_str()),
            "Recipe test requires loopback PostgreSQL"
        );
        let options = PgConnectOptions::new()
            .host(&cfg.host)
            .port(cfg.port)
            .username(&cfg.user)
            .password(&cfg.password)
            .database("postgres");
        let mut admin = PgConnection::connect_with(&options).await.unwrap();
        let schema = format!(
            "recipe_test_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        admin
            .execute(AssertSqlSafe(format!("CREATE SCHEMA {schema}")))
            .await
            .unwrap();
        let pool = PgPoolOptions::new()
            .max_connections(3)
            .connect_with(options.options([("search_path", schema.as_str())]))
            .await
            .unwrap();
        let test_pool = pool.clone();
        let result = tokio::spawn(async move { verify_roundtrip(test_pool).await }).await;
        pool.close().await;
        admin
            .execute(AssertSqlSafe(format!("DROP SCHEMA {schema} CASCADE")))
            .await
            .unwrap();
        result.unwrap();
    }

    async fn verify_roundtrip(pool: PgPool) {
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        // A second startup must keep existing rows and not seed duplicates.
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let rows = list(&pool).await.unwrap();
        assert_eq!(rows.len(), 10);
        assert_eq!(rows.iter().filter(|r| r.customer == "TM").count(), 5);
        assert!(rows.iter().all(|r| !r.configured && r.recipe_rev == 0));
        let initial = get(&pool, "MH1253R").await.unwrap();
        assert_eq!(initial.stations, Stations::default());
        assert!(get(&pool, "MISSING").await.is_err());

        let mut input = valid_recipe();
        input.stations.butt.num_points = Some(10);
        input.stations.butt.points = std::array::from_fn(|i| Point {
            pos_linear: Some(i as f64),
            pos_press_fixed: Some(i as f64 + 10.0),
            pos_force: Some(i as f64 + 20.0),
            load: Some(i as f64 + 30.0),
            bend: Some(i as f64 + 40.0),
        });
        input.validate_and_normalize().unwrap();
        let first = save(&pool, input.clone()).await.unwrap();
        assert!(first.summary.configured);
        assert_eq!(first.summary.recipe_rev, 1);
        assert_eq!(
            get(&pool, &input.sku).await.unwrap().stations,
            input.stations
        );
        assert_eq!(get(&pool, "IH1279S").await.unwrap().summary.recipe_rev, 0);
        input.recipe_rev = 1;
        let same = save(&pool, input.clone()).await.unwrap();
        assert_eq!(same.summary.recipe_rev, 1);
        assert_eq!(same.summary.updated_at, first.summary.updated_at);

        // Fail the second station's update after BUTT has been updated. All writes must roll back.
        sqlx::raw_sql("CREATE FUNCTION fail_recipe_tip() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN IF NEW.station = 'TIP' THEN RAISE EXCEPTION 'test rollback'; END IF; RETURN NEW; END $$;
            CREATE TRIGGER fail_tip BEFORE UPDATE ON recipe_stations FOR EACH ROW EXECUTE FUNCTION fail_recipe_tip();")
            .execute(&pool).await.unwrap();
        input.stations.butt.points[0].load = Some(999.0);
        assert!(save(&pool, input.clone()).await.is_err());
        let after_error = get(&pool, &input.sku).await.unwrap();
        assert_eq!(after_error.stations, first.stations);
        assert_eq!(after_error.summary.recipe_rev, 1);
        sqlx::raw_sql("DROP TRIGGER fail_tip ON recipe_stations; DROP FUNCTION fail_recipe_tip();")
            .execute(&pool)
            .await
            .unwrap();

        // Two editors holding revision 1: exactly one succeeds.
        let mut competing = input.clone();
        competing.stations.butt.points[0].load = Some(888.0);
        let (a, b) = tokio::join!(save(&pool, input.clone()), save(&pool, competing));
        assert_ne!(a.is_ok(), b.is_ok());
        assert_eq!(get(&pool, &input.sku).await.unwrap().summary.recipe_rev, 2);
        let current = get(&pool, &input.sku).await.unwrap();
        input.recipe_rev = 2;
        input.stations = current.stations;
        let original_points = input.stations.butt.points.clone();
        input.stations.butt.enabled = Some(0);
        input.stations.butt.num_points = Some(1);
        let disabled = save(&pool, input.clone()).await.unwrap();
        assert_eq!(disabled.stations.butt.enabled, Some(0));
        assert_eq!(disabled.stations.butt.num_points, Some(1));
        assert_eq!(disabled.stations.butt.points, original_points);
        assert_eq!(disabled.summary.recipe_rev, 3);
        input.recipe_rev = 3;
        assert_eq!(
            save(&pool, input.clone()).await.unwrap().summary.recipe_rev,
            3
        );
        input.stations.butt.enabled = Some(1);
        let enabled = save(&pool, input.clone()).await.unwrap();
        assert_eq!(enabled.summary.recipe_rev, 4);
        assert_eq!(enabled.stations.butt.points, original_points);
        input.recipe_rev = 4;
        input.stations.butt.points[0].load = Some(0.0);
        assert!(save(&pool, input).await.is_err());
        assert_eq!(get(&pool, "MH1253R").await.unwrap().summary.recipe_rev, 4);
        let result_count: i64 = sqlx::query_scalar("SELECT count(*) FROM stick")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(result_count, 0);
    }
}
