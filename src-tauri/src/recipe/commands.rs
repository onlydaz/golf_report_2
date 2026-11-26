use super::transfer::{RecipeTransfer, TransferError, TransferReport, TransferStatus};
use super::{
    model::{Recipe, RecipeSummary, SaveRecipe},
    store,
};
use crate::db::DbPool;
use crate::plc::PlcHandle;
use tauri::State;

#[tauri::command]
pub async fn recipe_list(db: State<'_, DbPool>) -> Result<Vec<RecipeSummary>, String> {
    store::list(&db.get()?).await
}

#[tauri::command]
pub async fn recipe_get(db: State<'_, DbPool>, sku: String) -> Result<Recipe, String> {
    store::get(&db.get()?, &sku).await
}

#[tauri::command]
pub async fn recipe_save(db: State<'_, DbPool>, lifecycle: State<'_, crate::shutdown::Shutdown>, recipe: SaveRecipe) -> Result<Recipe, String> {
    let _operation = lifecycle.operation()?;
    store::save(&db.get()?, recipe).await
}

#[tauri::command]
pub async fn recipe_apply(
    db: State<'_, DbPool>,
    plc: State<'_, PlcHandle>,
    transfer: State<'_, RecipeTransfer>,
    sku: String,
    recipe_rev: i32,
    lifecycle: State<'_, crate::shutdown::Shutdown>,
) -> Result<TransferReport, TransferError> {
    let _operation = lifecycle.operation().map_err(TransferError::failed)?;
    let pool = db.get().map_err(TransferError::failed)?;
    transfer
        .apply(&plc, recipe_rev, store::get(&pool, &sku))
        .await
}

#[tauri::command]
pub async fn recipe_plc_status(
    plc: State<'_, PlcHandle>,
    transfer: State<'_, RecipeTransfer>,
) -> Result<TransferStatus, String> {
    Ok(transfer.status(&plc).await)
}

#[tauri::command]
pub async fn recipe_reconcile(
    plc: State<'_, PlcHandle>,
    transfer: State<'_, RecipeTransfer>,
    lifecycle: State<'_, crate::shutdown::Shutdown>,
) -> Result<TransferReport, TransferError> {
    let _operation = lifecycle.operation().map_err(TransferError::failed)?;
    transfer.reconcile(&plc).await
}
