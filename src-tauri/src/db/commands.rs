//! Tauri commands for reading saved sticks. Errors are plain messages for the UI.

use tauri::State;

use super::query::{self, SkuSummary, StickDetail, StickFilter, StickPage, StickStats};
use super::DbPool;

fn msg(e: sqlx::Error) -> String {
    eprintln!("db: query failed: {e}");
    format!("Lỗi truy vấn cơ sở dữ liệu: {e}")
}

#[tauri::command]
pub async fn stick_stats(auth: State<'_, crate::auth::Auth>, db: State<'_, DbPool>, filter: StickFilter) -> Result<StickStats, String> {
    let _access = auth.require(&db, false).await?;
    query::stick_stats(&db.get()?, &filter).await.map_err(msg)
}

#[tauri::command]
pub async fn stick_list(
    auth: State<'_, crate::auth::Auth>,
    db: State<'_, DbPool>,
    filter: StickFilter,
    page: i64,
    page_size: i64,
) -> Result<StickPage, String> {
    let _access = auth.require(&db, false).await?;
    query::stick_list(&db.get()?, &filter, page, page_size).await.map_err(msg)
}

#[tauri::command]
pub async fn sku_summary(auth: State<'_, crate::auth::Auth>, db: State<'_, DbPool>, filter: StickFilter) -> Result<Vec<SkuSummary>, String> {
    let _access = auth.require(&db, false).await?;
    query::sku_summary(&db.get()?, &filter).await.map_err(msg)
}

#[tauri::command]
pub async fn stick_detail(auth: State<'_, crate::auth::Auth>, db: State<'_, DbPool>, id: i64) -> Result<Option<StickDetail>, String> {
    let _access = auth.require(&db, false).await?;
    query::stick_detail(&db.get()?, id).await.map_err(msg)
}

#[tauri::command]
pub async fn report_summary(
    auth: State<'_, crate::auth::Auth>,
    db: State<'_, DbPool>, info: State<'_, crate::app_info::AppInfo>,
    filter: StickFilter, timezone: String,
) -> Result<super::report::ReportSummary, String> {
    let _access = auth.require(&db, false).await?;
    super::report::summary(&db.get()?, &filter, &timezone, &info.measurement.butt).await.map_err(msg)
}

#[tauri::command]
pub async fn report_export_batch(
    auth: State<'_, crate::auth::Auth>,
    db: State<'_, DbPool>, filter: StickFilter, after_id: i64, max_id: Option<i64>,
) -> Result<super::report::ExportBatch, String> {
    let _access = auth.require(&db, false).await?;
    super::report::export_batch(&db.get()?, &filter, after_id, max_id).await.map_err(msg)
}
