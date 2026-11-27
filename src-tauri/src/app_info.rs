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
pub async fn app_info(auth: State<'_, crate::auth::Auth>, db: State<'_, crate::db::DbPool>, info: State<'_, AppInfo>) -> Result<AppInfo, String> {
    let _access = auth.require(&db, false).await?;
    Ok(info.inner().clone())
}
