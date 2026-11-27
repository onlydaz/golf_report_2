use super::transfer::{Outcome, RecipeTransfer, TransferError, TransferReport, TransferStatus};
use super::{
    model::{Recipe, RecipeSummary, SaveRecipe},
    store,
};
use crate::db::DbPool;
use crate::plc::{PlcHandle, PlcStatus};
use crate::production::Production;
use tauri::State;

#[tauri::command]
pub async fn recipe_list(
    auth: State<'_, crate::auth::Auth>,
    db: State<'_, DbPool>,
) -> Result<Vec<RecipeSummary>, String> {
    let _access = auth.require(&db, false).await?;
    store::list(&db.get()?).await
}

#[tauri::command]
pub async fn recipe_get(
    auth: State<'_, crate::auth::Auth>,
    db: State<'_, DbPool>,
    sku: String,
) -> Result<Recipe, String> {
    let _access = auth.require(&db, false).await?;
    store::get(&db.get()?, &sku).await
}

#[tauri::command]
pub async fn recipe_save(
    auth: State<'_, crate::auth::Auth>,
    db: State<'_, DbPool>,
    production: State<'_, Production>,
    lifecycle: State<'_, crate::shutdown::Shutdown>,
    recipe: SaveRecipe,
) -> Result<Recipe, String> {
    let _access = auth.require(&db, true).await?;
    let _operation = lifecycle.operation()?;
    let _transition = production
        .transition
        .try_lock()
        .map_err(|_| "Đang nạp hoặc xác nhận công thức. Vui lòng chờ trước khi lưu.")?;
    store::save(&db.get()?, recipe).await
}

#[tauri::command]
pub async fn recipe_apply(
    app: tauri::AppHandle,
    production: State<'_, Production>,
    auth: State<'_, crate::auth::Auth>,
    db: State<'_, DbPool>,
    plc: State<'_, PlcHandle>,
    transfer: State<'_, RecipeTransfer>,
    sku: String,
    recipe_rev: i32,
    lifecycle: State<'_, crate::shutdown::Shutdown>,
) -> Result<TransferReport, TransferError> {
    let _access = auth
        .require(&db, false)
        .await
        .map_err(TransferError::failed)?;
    let _operation = lifecycle.operation().map_err(TransferError::failed)?;
    let _transition = production
        .transition
        .try_lock()
        .map_err(|_| TransferError::failed("Đang xác nhận SKU sản xuất. Vui lòng chờ."))?;
    let pool = db.get().map_err(TransferError::failed)?;
    let _pause = lifecycle
        .pause_collection()
        .await
        .map_err(TransferError::failed)?;
    let mut connection = plc.subscribe_status();
    if *connection.borrow_and_update() != PlcStatus::Connected {
        return Err(TransferError::failed("PLC chưa kết nối."));
    }
    ensure_drained(&plc).await.map_err(TransferError::failed)?;
    let result = transfer
        .apply(&plc, recipe_rev, store::get(&pool, &sku))
        .await;
    finish_production(
        &app,
        &production,
        &plc,
        &transfer,
        &pool,
        &connection,
        result,
    )
    .await
}

#[tauri::command]
pub async fn recipe_plc_status(
    app: tauri::AppHandle,
    production: State<'_, Production>,
    lifecycle: State<'_, crate::shutdown::Shutdown>,
    auth: State<'_, crate::auth::Auth>,
    db: State<'_, DbPool>,
    plc: State<'_, PlcHandle>,
    transfer: State<'_, RecipeTransfer>,
) -> Result<TransferStatus, String> {
    let _access = auth.require(&db, false).await?;
    // Reuse the existing status request. No automatic apply/reconcile and no PLC writes.
    let Ok(_transition) = production.transition.try_lock() else {
        return Ok(transfer.status(&plc).await);
    };
    let mut connection = plc.subscribe_status();
    connection.borrow_and_update();
    let status = transfer.status(&plc).await;
    let snapshot = production.get();
    if snapshot.error.is_none() {
        return Ok(status);
    }
    let Some(selection) = snapshot.selection else {
        return Ok(status);
    };
    production.uncertain(&app);
    let Some(h) = status.handshake.as_ref() else { return Ok(status); };
    if status.busy || status.needs_reconcile || h.pc_cmd != 0 || h.plc_ack != 0
        || h.plc_idle != 1 || h.act_sku != selection.sku {
        return Ok(status);
    }
    let pool = db.get()?;
    let Ok(recipe) = store::get(&pool, &selection.sku).await else { return Ok(status); };
    if recipe.summary.customer != selection.customer || !matches_recipe(&status, &recipe)
        || super::encode::encode(&recipe).is_err() || super::encode::check_result_capacity(&recipe).is_err() {
        return Ok(status);
    }
    let Ok(_operation) = lifecycle.operation() else { return Ok(status); };
    let Ok(_pause) = lifecycle.pause_collection().await else { return Ok(status); };
    // Preserve the collection boundary used by manual confirmation. Re-read the
    // handshake after pausing; the earlier status alone is not commit evidence.
    let status = transfer.status(&plc).await;
    if matches_recipe(&status, &recipe) && ensure_drained(&plc).await.is_ok()
        && !connection.has_changed().unwrap_or(true) && *connection.borrow() == PlcStatus::Connected {
        production.confirm(&app, selection.customer, selection.sku, &connection)?;
    }
    Ok(status)
}

#[tauri::command]
pub async fn recipe_reconcile(
    app: tauri::AppHandle,
    production: State<'_, Production>,
    auth: State<'_, crate::auth::Auth>,
    db: State<'_, DbPool>,
    plc: State<'_, PlcHandle>,
    transfer: State<'_, RecipeTransfer>,
    lifecycle: State<'_, crate::shutdown::Shutdown>,
) -> Result<TransferReport, TransferError> {
    let _access = auth
        .require(&db, false)
        .await
        .map_err(TransferError::failed)?;
    let _operation = lifecycle.operation().map_err(TransferError::failed)?;
    let _transition = production
        .transition
        .try_lock()
        .map_err(|_| TransferError::failed("Đang xác nhận SKU sản xuất. Vui lòng chờ."))?;
    let pool = db.get().map_err(TransferError::failed)?;
    let _pause = lifecycle
        .pause_collection()
        .await
        .map_err(TransferError::failed)?;
    let mut connection = plc.subscribe_status();
    connection.borrow_and_update();
    ensure_drained(&plc).await.map_err(TransferError::failed)?;
    let result = transfer.reconcile(&plc).await;
    finish_production(
        &app,
        &production,
        &plc,
        &transfer,
        &pool,
        &connection,
        result,
    )
    .await
}

async fn ensure_drained(plc: &PlcHandle) -> Result<(), String> {
    let control = crate::plc::control::read_control_area(plc)
        .await
        .map_err(|e| e.to_string())?;
    if control.data_ready != 0
        || control.pc_read_done != 0
        || control.total_count != control.pc_read_count
    {
        return Err("PLC còn kết quả chưa được xác nhận hoặc chưa xóa ACK dữ liệu. Chưa thể chuyển SKU sản xuất.".into());
    }
    Ok(())
}

fn matches_recipe(status: &TransferStatus, recipe: &Recipe) -> bool {
    !status.busy && !status.needs_reconcile && status.read_error.is_none()
        && status.handshake.as_ref().is_some_and(|h|
            h.pc_cmd == 0 && h.plc_ack == 0 && h.plc_idle == 1
                && h.act_sku == recipe.summary.sku && h.act_rev == recipe.summary.recipe_rev)
}

// Both roles share this backend-only commit. Collection remains paused until it returns.
async fn finish_production(
    app: &tauri::AppHandle,
    production: &Production,
    plc: &PlcHandle,
    transfer: &RecipeTransfer,
    pool: &sqlx::PgPool,
    connection: &tokio::sync::watch::Receiver<PlcStatus>,
    result: Result<TransferReport, TransferError>,
) -> Result<TransferReport, TransferError> {
    let report = match result {
        Ok(report) => report,
        Err(error) => {
            if error.kind == Outcome::Unknown {
                production.uncertain(app);
            }
            return Err(error);
        }
    };
    if report.outcome == Outcome::Unknown {
        production.uncertain(app);
        return Ok(report);
    }
    if report.outcome == Outcome::Failed {
        let current = production.get();
        if current
            .selection
            .as_ref()
            .is_none_or(|s| s.sku != report.handshake.act_sku)
        {
            production.uncertain(app);
        }
        return Ok(report);
    }
    let confirm = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        let recipe = store::get(pool, &report.handshake.act_sku).await?;
        super::encode::encode(&recipe)?;
        super::encode::check_result_capacity(&recipe)?;
        if recipe.summary.recipe_rev != report.handshake.act_rev {
            return Err(
                "Phiên bản công thức đã lưu thay đổi trong lúc nạp. Cần tải lại và đối chiếu PLC."
                    .to_string(),
            );
        }
        let status = transfer.status(plc).await;
        if !matches_recipe(&status, &recipe) {
            return Err("Chưa xác nhận được đúng công thức và handshake hoàn tất trên PLC.".into());
        }
        ensure_drained(plc).await?;
        if connection.has_changed().unwrap_or(true) || *connection.borrow() != PlcStatus::Connected
        {
            return Err("Kết nối PLC đã thay đổi khi xác nhận SKU sản xuất.".into());
        }
        production.confirm(app, recipe.summary.customer, recipe.summary.sku, connection)
    })
    .await
    .unwrap_or_else(|_| Err("Hết thời gian xác nhận SKU sản xuất. Cần kiểm tra và đối chiếu lại PLC.".into()));
    if let Err(message) = confirm {
        production.uncertain(app);
        return Err(TransferError::unknown(message));
    }
    Ok(TransferReport {
        message: format!("{} Đã xác nhận SKU sản xuất.", report.message),
        ..report
    })
}
