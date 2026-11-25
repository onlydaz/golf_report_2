//! Postgres storage of PLC records.
//!
//! [`spawn_writer`] owns the connection pool: it connects (creating the database
//! and tables if needed), then saves every record sent to it, in order.

mod store;

use std::time::Duration;

use serde::Serialize;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{AssertSqlSafe, Connection, Executor, PgConnection, PgPool};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

use crate::config::DbConfig;
use crate::plc::record::StickRecord;

pub use store::save_record;

/// Records waiting to be saved (also covers the time before the DB is reachable).
const QUEUE_CAPACITY: usize = 256;
const RECONNECT_DELAY: Duration = Duration::from_secs(5);

/// Maintenance database used to check for / create `cfg.dbname`.
const MAINTENANCE_DB: &str = "postgres";

fn options(cfg: &DbConfig, dbname: &str) -> PgConnectOptions {
    PgConnectOptions::new()
        .host(&cfg.host)
        .port(cfg.port)
        .username(&cfg.user)
        .password(&cfg.password)
        .database(dbname)
}

/// Double-quote an identifier for use in SQL.
fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// Create `cfg.dbname` if it does not exist.
async fn ensure_database(cfg: &DbConfig) -> Result<(), sqlx::Error> {
    let mut conn = PgConnection::connect_with(&options(cfg, MAINTENANCE_DB)).await?;
    let exists: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)")
        .bind(&cfg.dbname)
        .fetch_one(&mut conn)
        .await?;
    if !exists {
        let sql = format!("CREATE DATABASE {}", quote_ident(&cfg.dbname));
        conn.execute(AssertSqlSafe(sql)).await?;
    }
    conn.close().await
}

/// Create the database if missing, open a pool and run the migrations.
pub async fn connect(cfg: &DbConfig) -> Result<PgPool, sqlx::Error> {
    ensure_database(cfg).await?;
    let pool = PgPoolOptions::new()
        .max_connections(cfg.max_connections)
        .acquire_timeout(Duration::from_secs(5))
        .connect_with(options(cfg, &cfg.dbname))
        .await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    Ok(pool)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbStatus {
    pub connected: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub id: i64,
    pub record_seq: i32,
    pub stick_no: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbError {
    pub record_seq: Option<i32>,
    pub message: String,
}

/// Start the writer task. Events: `db://status`, `db://saved`, `db://error`.
pub fn spawn_writer(cfg: DbConfig, app: AppHandle) -> mpsc::Sender<StickRecord> {
    let (tx, mut rx) = mpsc::channel::<StickRecord>(QUEUE_CAPACITY);
    tauri::async_runtime::spawn(async move {
        let pool = loop {
            match connect(&cfg).await {
                Ok(pool) => break pool,
                Err(e) => {
                    eprintln!("db: connect failed: {e}");
                    let _ = app.emit("db://status", DbStatus { connected: false, error: Some(e.to_string()) });
                    tokio::time::sleep(RECONNECT_DELAY).await;
                }
            }
        };
        let _ = app.emit("db://status", DbStatus { connected: true, error: None });

        while let Some(r) = rx.recv().await {
            match save_record(&pool, &r).await {
                Ok(id) => {
                    let _ = app.emit(
                        "db://saved",
                        Saved { id, record_seq: r.record_seq, stick_no: r.stick_no },
                    );
                }
                Err(e) => {
                    eprintln!("db: save record_seq {} failed: {e}", r.record_seq);
                    let _ = app.emit(
                        "db://error",
                        DbError { record_seq: Some(r.record_seq), message: e.to_string() },
                    );
                }
            }
        }
    });
    tx
}
