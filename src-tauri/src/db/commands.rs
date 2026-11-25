//! Tauri commands for reading saved sticks. Errors are plain messages for the UI.

use tauri::State;

use super::query::{self, SkuSummary, StickDetail, StickFilter, StickPage, StickStats};
use super::DbPool;

fn msg(e: sqlx::Error) -> String {
    eprintln!("db: query failed: {e}");
    format!("Lỗi truy vấn cơ sở dữ liệu: {e}")
}

#[tauri::command]
pub async fn stick_stats(db: State<'_, DbPool>, filter: StickFilter) -> Result<StickStats, String> {
    query::stick_stats(&db.get()?, &filter).await.map_err(msg)
}

#[tauri::command]
pub async fn stick_list(
    db: State<'_, DbPool>,
    filter: StickFilter,
    page: i64,
    page_size: i64,
) -> Result<StickPage, String> {
    query::stick_list(&db.get()?, &filter, page, page_size).await.map_err(msg)
}

#[tauri::command]
pub async fn sku_summary(db: State<'_, DbPool>, filter: StickFilter) -> Result<Vec<SkuSummary>, String> {
    query::sku_summary(&db.get()?, &filter).await.map_err(msg)
}

#[tauri::command]
pub async fn stick_detail(db: State<'_, DbPool>, id: i64) -> Result<Option<StickDetail>, String> {
    query::stick_detail(&db.get()?, id).await.map_err(msg)
}
