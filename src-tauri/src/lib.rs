mod app_info;
mod config;
mod db;
mod plc;
mod recipe;

use tauri::{Emitter, Manager};

use config::AppConfig;
use plc::{commands::*, run_poller, spawn_plc_actor, PlcConfig, PollEvent};

/// Max wait for the DB save before acknowledging the PLC anyway.
const SAVE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.set_icon(tauri::include_image!("./icons/128x128.png"))?;
            }
            let started_at = chrono::Utc::now();
            let app_cfg = AppConfig::load();
            app.manage(recipe::transfer::RecipeTransfer::new(app_cfg.recipe_transfer));
            // Saves records to Postgres; creates the database and tables if missing.
            let db_status = db::DbStatusState::default();
            let db_pool = db::DbPool::default();
            let db_tx = db::spawn_writer(
                app_cfg.database,
                app.handle().clone(),
                db_status.clone(),
                db_pool.clone(),
            );
            app.manage(db_status);
            app.manage(db_pool);

            let cfg = PlcConfig::default();
            let diagnostics = plc::diagnostics::DiagnosticsState::new(&cfg);
            app.manage(diagnostics.clone());
            app.manage(app_info::AppInfo {
                started_at,
                plc_addr: cfg.addr.to_string(),
                measurement: app_cfg.measurement,
            });
            let poll_interval = cfg.poll_interval;
            let plc = spawn_plc_actor(cfg);

            // Forward connection status changes to the frontend.
            let mut status_rx = plc.subscribe_status();
            let app_handle = app.handle().clone();
            let status_diagnostics = diagnostics.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    let status = status_rx.borrow_and_update().clone();
                    let _ = app_handle.emit("plc://diagnostics", status_diagnostics.status(status.clone()));
                    let _ = app_handle.emit("plc://status", status);
                    if status_rx.changed().await.is_err() {
                        break;
                    }
                }
            });

            // Poll the control area; on DataReady 0 -> 1 read record [0], save it,
            // then ack the PLC (PC_ReadCount + 1, PC_ReadDone = 1).
            let app_handle = app.handle().clone();
            let save_app = app.handle().clone();
            let emit = move |ev| {
                let _ = match ev {
                    PollEvent::ReadDiagnostics { elapsed_ms, failed } => app_handle.emit("plc://diagnostics", diagnostics.read(elapsed_ms, failed)),
                    PollEvent::Control(c) => app_handle.emit("plc://control", c),
                    PollEvent::Record(r) => app_handle.emit("plc://record", &r),
                    PollEvent::Error(e) => app_handle.emit("plc://poll-error", e),
                };
            };
            let save = move |record: plc::record::StickRecord| {
                let db_tx = db_tx.clone();
                let app = save_app.clone();
                async move {
                    let record_seq = record.record_seq;
                    let (done, rx) = tokio::sync::oneshot::channel();
                    // The writer emits db://saved / db://error for the save itself;
                    // only queue failures and timeouts are reported here.
                    let message = match db_tx.try_send(db::SaveRequest { record, done }) {
                        Err(e) => Some(format!("save queue: {e}")),
                        Ok(()) => match tokio::time::timeout(SAVE_TIMEOUT, rx).await {
                            Ok(_) => None,
                            Err(_) => Some("save timeout, PLC acknowledged anyway".to_string()),
                        },
                    };
                    if let Some(message) = message {
                        let _ = app.emit("db://error", db::DbError { record_seq: Some(record_seq), message });
                    }
                }
            };
            tauri::async_runtime::spawn(run_poller(plc.clone(), poll_interval, emit, save));

            app.manage(plc);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            plc_status,
            plc::diagnostics::plc_diagnostics,
            plc::diagnostics::plc_clear_connection_log,
            plc_read_coils,
            plc_read_discrete_inputs,
            plc_read_holding_registers,
            plc_read_input_registers,
            plc_write_coil,
            plc_write_register,
            plc_write_coils,
            plc_write_registers,
            plc_read_control_area,
            plc_reset_read_count,
            db::db_status,
            db::commands::stick_stats,
            db::commands::stick_list,
            db::commands::sku_summary,
            db::commands::stick_detail,
            db::commands::report_summary,
            db::commands::report_export_batch,
            app_info::app_info,
            recipe::commands::recipe_list,
            recipe::commands::recipe_get,
            recipe::commands::recipe_save,
            recipe::commands::recipe_apply,
            recipe::commands::recipe_plc_status,
            recipe::commands::recipe_reconcile,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
