//! In-memory observation only; never issues PLC operations.
use std::sync::{Arc, Mutex};
use chrono::{DateTime, Local, Utc};
use serde::Serialize;
use tauri::State;
use super::{PlcConfig, PlcStatus};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionLog {
    at: DateTime<Utc>,
    tone: String,
    message: String,
    address: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    revision: u64,
    ip: String,
    port: u16,
    unit_id: u8,
    status: PlcStatus,
    connected_at: Option<DateTime<Utc>>,
    read_latency_ms: Option<f64>,
    day: String,
    read_errors_today: u64,
    disconnects_today: u64,
    logs: Vec<ConnectionLog>,
}

#[derive(Clone)]
pub struct DiagnosticsState(Arc<Mutex<Diagnostics>>);

impl DiagnosticsState {
    pub fn new(cfg: &PlcConfig) -> Self {
        Self(Arc::new(Mutex::new(Diagnostics {
            revision: 0, ip: cfg.addr.ip().to_string(), port: cfg.addr.port(), unit_id: cfg.slave,
            status: PlcStatus::Connecting, connected_at: None, read_latency_ms: None,
            day: Local::now().format("%Y-%m-%d").to_string(), read_errors_today: 0, disconnects_today: 0,
            logs: vec![ConnectionLog { at: Utc::now(), tone: "connecting".into(),
                message: "Đang kết nối PLC".into(), address: cfg.addr.to_string() }],
        })))
    }

    pub fn snapshot(&self) -> Diagnostics {
        let mut d = self.0.lock().unwrap();
        d.roll_day(&Local::now().format("%Y-%m-%d").to_string());
        d.clone()
    }

    pub fn status(&self, status: PlcStatus) -> Diagnostics {
        let mut d = self.0.lock().unwrap();
        d.roll_day(&Local::now().format("%Y-%m-%d").to_string());
        if d.status != status {
            let was_connected = d.status == PlcStatus::Connected;
            let (tone, message) = match &status {
                PlcStatus::Connected => ("connected", "Kết nối PLC thành công".to_string()),
                PlcStatus::Connecting => ("connecting", "Đang kết nối lại PLC".to_string()),
                PlcStatus::Disconnected { reason } => {
                    if was_connected { d.disconnects_today += 1; }
                    ("disconnected", format!("{}: {reason}", if was_connected { "Mất kết nối PLC" } else { "Kết nối PLC thất bại" }))
                }
            };
            d.connected_at = if status == PlcStatus::Connected { Some(Utc::now()) } else { None };
            d.read_latency_ms = None;
            let address = format!("{}:{}", d.ip, d.port);
            d.logs.insert(0, ConnectionLog { at: Utc::now(), tone: tone.into(), message, address });
            d.logs.truncate(100);
            d.status = status;
            d.revision += 1;
        }
        d.clone()
    }

    pub fn read(&self, elapsed_ms: f64, failed: bool) -> Diagnostics {
        let mut d = self.0.lock().unwrap();
        d.roll_day(&Local::now().format("%Y-%m-%d").to_string());
        d.read_latency_ms = Some(elapsed_ms);
        if failed { d.read_errors_today += 1; }
        d.revision += 1;
        d.clone()
    }

    pub fn clear(&self) -> Diagnostics {
        let mut d = self.0.lock().unwrap();
        d.logs.clear();
        d.revision += 1;
        d.clone()
    }
}

impl Diagnostics {
    fn roll_day(&mut self, day: &str) {
        if self.day != day {
            self.day = day.into();
            self.read_errors_today = 0;
            self.disconnects_today = 0;
            self.revision += 1;
        }
    }
}

#[tauri::command]
pub async fn plc_diagnostics(auth: State<'_, crate::auth::Auth>, db: State<'_, crate::db::DbPool>, state: State<'_, DiagnosticsState>) -> Result<Diagnostics, String> {
    let _access = auth.require(&db, false).await?;
    Ok(state.snapshot())
}

#[tauri::command]
pub async fn plc_clear_connection_log(auth: State<'_, crate::auth::Auth>, db: State<'_, crate::db::DbPool>, state: State<'_, DiagnosticsState>, app: tauri::AppHandle) -> Result<Diagnostics, String> {
    let _access = auth.require(&db, true).await?;
    use tauri::Emitter;
    let snapshot = state.clear();
    let _ = app.emit("plc://diagnostics", &snapshot);
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transitions_are_bounded_deduplicated_and_clear_only_removes_logs() {
        let state = DiagnosticsState::new(&PlcConfig::default());
        state.status(PlcStatus::Connected);
        assert_eq!(state.status(PlcStatus::Connected).logs.len(), 2);
        state.read(12.5, true);
        for _ in 0..60 {
            state.status(PlcStatus::Disconnected { reason: "lost".into() });
            state.status(PlcStatus::Connecting);
            state.status(PlcStatus::Connected);
        }
        let before = state.snapshot();
        assert_eq!(before.logs.len(), 100);
        assert_eq!(before.disconnects_today, 60);
        let after = state.clear();
        assert!(after.logs.is_empty());
        assert_eq!(after.connected_at, before.connected_at);
        assert_eq!(after.read_errors_today, 1);
        assert_eq!(after.disconnects_today, 60);
        assert_eq!(after.status, PlcStatus::Connected);
    }
    #[test]
    fn failed_connect_is_not_a_disconnect_and_day_reset_preserves_logs() {
        let state = DiagnosticsState::new(&PlcConfig::default());
        state.status(PlcStatus::Disconnected { reason: "refused".into() });
        state.read(3.0, true);
        let mut d = state.snapshot();
        assert_eq!(d.disconnects_today, 0);
        d.roll_day("2099-01-01");
        assert_eq!(d.read_errors_today, 0);
        assert_eq!(d.logs.len(), 2);
    }
}
