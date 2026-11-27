//! Postgres storage of PLC records.
//!
//! [`spawn_writer`] owns the connection pool: it connects (creating the database
//! and tables if needed), then saves every record sent to it, in order.

pub mod commands;
mod query;
mod report;
mod store;

use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{AssertSqlSafe, Connection, Executor, PgConnection, PgPool};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot};

use crate::config::DbConfig;
use crate::plc::record::StickRecord;

#[cfg(test)]
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

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbStatus {
    pub connected: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub production_session: Option<String>,
    pub id: i64,
    pub record_seq: i32,
    pub stick_no: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbError {
    pub production_session: Option<String>,
    pub record_seq: Option<i32>,
    pub message: String,
}

/// One record to save; the writer answers on `done` once the save finished.
pub struct SaveRequest {
    pub record: StickRecord,
    pub product_code: String,
    pub production_session: String,
    pub done: oneshot::Sender<Result<i64, String>>,
}

/// Latest connection status, readable by the `db_status` command (the frontend
/// may start listening after the first `db://status` event was emitted).
#[derive(Clone, Default)]
pub struct DbStatusState(Arc<Mutex<DbStatus>>);

impl DbStatusState {
    pub fn get(&self) -> DbStatus {
        self.0.lock().unwrap().clone()
    }

    fn set(&self, app: &AppHandle, status: DbStatus) {
        *self.0.lock().unwrap() = status.clone();
        let _ = app.emit("db://status", status);
    }
}

/// Pool shared with the query commands, set once the writer has connected.
#[derive(Clone, Default)]
pub struct DbPool(Arc<OnceLock<PgPool>>);

impl DbPool {
    /// The pool, or an error message for the frontend while the DB is unreachable.
    pub fn get(&self) -> Result<PgPool, String> {
        self.0.get().cloned().ok_or_else(|| "Chưa kết nối cơ sở dữ liệu".to_string())
    }
}

#[tauri::command]
pub async fn db_status(auth: tauri::State<'_, crate::auth::Auth>, db: tauri::State<'_, DbPool>, state: tauri::State<'_, DbStatusState>) -> Result<DbStatus, String> {
    let _access = auth.require(&db, false).await?;
    Ok(state.get())
}

/// Start the writer task. Events: `db://status`, `db://saved`, `db://error`.
pub fn spawn_writer(
    cfg: DbConfig,
    app: AppHandle,
    status: DbStatusState,
    shared: DbPool,
    lifecycle: crate::shutdown::Shutdown,
) -> mpsc::Sender<SaveRequest> {
    let (tx, mut rx) = mpsc::channel::<SaveRequest>(QUEUE_CAPACITY);
    tauri::async_runtime::spawn(async move {
        let pool = loop {
            match connect(&cfg).await {
                Ok(pool) => break pool,
                Err(e) => {
                    eprintln!("db: connect failed: {e}");
                    status.set(&app, DbStatus { connected: false, error: Some(e.to_string()) });
                    tokio::time::sleep(RECONNECT_DELAY).await;
                }
            }
        };
        let _ = shared.0.set(pool.clone());
        status.set(&app, DbStatus { connected: true, error: None });

        while let Some(SaveRequest { record: r, product_code, production_session, done }) = rx.recv().await {
            let result = match store::save_session_record(&pool, &r, &product_code, Some(&production_session)).await {
                Ok(id) => {
                    let _ = app.emit(
                        "db://saved",
                        Saved { id, record_seq: r.record_seq, stick_no: r.stick_no, production_session: Some(production_session.clone()) },
                    );
                    Ok(id)
                }
                Err(e) => {
                    eprintln!("db: save record_seq {} failed: {e}", r.record_seq);
                    let _ = app.emit(
                        "db://error",
                        DbError { record_seq: Some(r.record_seq), message: e.to_string(), production_session: Some(production_session.clone()) },
                    );
                    Err(e.to_string())
                }
            };
            // The poller may have stopped waiting (timeout); that is fine.
            lifecycle.finish_save(result.is_ok());
            let _ = done.send(result);
        }
    });
    tx
}
