//! Static facts about this run of the app, read once by the UI.

use chrono::{DateTime, Utc};
use serde::Serialize;
use tauri::State;

use crate::config::MeasurementConfig;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    /// Start of this run; the monitor counts sticks received since then.
    pub started_at: DateTime<Utc>,
    /// PLC address as `ip:port`.
    pub plc_addr: String,
    pub measurement: MeasurementConfig,
}

#[tauri::command]
pub fn app_info(info: State<'_, AppInfo>) -> AppInfo {
    info.inner().clone()
}
