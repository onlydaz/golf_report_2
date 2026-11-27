mod app_info;
mod config;
mod db;
mod plc;
mod recipe;
mod production;
mod shutdown;

use tauri::{Emitter, Manager};
use std::sync::{Arc, Mutex, atomic::Ordering};

use config::AppConfig;
use plc::{commands::*, run_poller_with_shutdown, spawn_plc_actor, PlcConfig, PollEvent};

/// Max wait for the DB save before acknowledging the PLC anyway.
const SAVE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.set_icon(tauri::include_image!("./icons/128x128.png"))?;
            }
            let started_at = chrono::Utc::now();
            let app_cfg = AppConfig::load();
            app.manage(production::Production::load(app.path().app_config_dir()?.join("production-sku.json")));
            let (lifecycle, mut exit_rx) = shutdown::Shutdown::new();
            app.manage(lifecycle.clone());
            app.manage(recipe::transfer::RecipeTransfer::new(app_cfg.recipe_transfer));
            // Saves records to Postgres; creates the database and tables if missing.
            let db_status = db::DbStatusState::default();
            let db_pool = db::DbPool::default();
            let db_tx = db::spawn_writer(
                app_cfg.database,
                app.handle().clone(),
                db_status.clone(),
                db_pool.clone(),
                lifecycle.clone(),
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
            let captured_sku = Arc::new(Mutex::new(None::<(String, String)>));
            let emit_sku = captured_sku.clone();
            let collection_lifecycle = lifecycle.clone();
            let emit = move |ev| {
                let _ = match ev {
                    PollEvent::ReadDiagnostics { elapsed_ms, failed } => app_handle.emit("plc://diagnostics", diagnostics.read(elapsed_ms, failed)),
                    PollEvent::Control(c) => app_handle.emit("plc://control", c),
                    PollEvent::Record(r) => {
                        let production = app_handle.state::<production::Production>().get();
                        let sku = production.selection.as_ref().map(|s| s.sku.clone()).unwrap_or_default();
                        *emit_sku.lock().unwrap() = Some((sku.clone(), production.session_id.clone()));
                        collection_lifecycle.begin_save();
                        // Preserve the PLC record, including raw ProductCode; publish selected SKU separately.
                        app_handle.emit("plc://record", serde_json::json!({ "record": r, "productCode": sku,
                            "production": production, "receivedAt": chrono::Utc::now() }))
                    },
                    PollEvent::Error(e) => app_handle.emit("plc://poll-error", e),
                };
            };
            let save_lifecycle = lifecycle.clone();
            let save = move |record: plc::record::StickRecord| {
                let (product_code, production_session) = captured_sku.lock().unwrap().take().expect("Record event precedes save");
                let db_tx = db_tx.clone();
                let app = save_app.clone();
                let lifecycle = save_lifecycle.clone();
                async move {
                    let record_seq = record.record_seq;
                    let (done, rx) = tokio::sync::oneshot::channel();
                    // The writer emits db://saved / db://error for the save itself;
                    // only queue failures and timeouts are reported here.
                    let message = match db_tx.try_send(db::SaveRequest { record, product_code, production_session: production_session.clone(), done }) {
                        Err(e) => {
                            lifecycle.finish_save(false);
                            Some(format!("save queue: {e}"))
                        },
                        Ok(()) => match tokio::time::timeout(SAVE_TIMEOUT, rx).await {
                            Ok(_) => None,
                            Err(_) => Some("save timeout, PLC acknowledged anyway".to_string()),
                        },
                    };
                    if let Some(message) = message {
                        let _ = app.emit("db://error", db::DbError { record_seq: Some(record_seq), message, production_session: Some(production_session) });
                    }
                }
            };
            let poller_plc = plc.clone();
            let exit_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut poller = Box::pin(run_poller_with_shutdown(poller_plc, poll_interval, emit, save,
                    lifecycle.pause.subscribe(), lifecycle.paused.clone()));
                loop {
                    tokio::select! {
                        biased;
                        _ = &mut poller => break,
                        Some(done) = exit_rx.recv() => {
                            lifecycle.pause.send_replace(true);
                            // Keep the original poller running while it finishes collection/ACK and the writer drains.
                            let wait = async {
                                loop {
                                    if lifecycle.can_stop() { break; }
                                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                                }
                            };
                            let ready = tokio::select! {
                                biased;
                                _ = &mut poller => {
                                    lifecycle.cancel();
                                    let _ = done.send(Err("Tác vụ thu thập đã dừng bất thường; chưa thể xác nhận thoát an toàn.".into()));
                                    return;
                                },
                                result = tokio::time::timeout(std::time::Duration::from_secs(15), wait) => result.is_ok(),
                            };
                            if !ready {
                                lifecycle.cancel();
                                let _ = done.send(Err("Chưa thể thoát an toàn: còn dữ liệu chờ lưu/lưu lỗi hoặc PLC chưa kết thúc chu kỳ dữ liệu/ACK. Ứng dụng tiếp tục thu thập; hãy kiểm tra rồi thử lại.".into()));
                                continue;
                            }
                            drop(poller);
                            if let Ok(pool) = exit_app.state::<db::DbPool>().get() {
                                let _ = tokio::time::timeout(std::time::Duration::from_secs(5), pool.close()).await;
                            }
                            lifecycle.approved.store(true, Ordering::SeqCst);
                            let _ = done.send(Ok(()));
                            exit_app.exit(0);
                            return;
                        }
                    }
                }
            });

            app.manage(plc);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("app://confirm-exit", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            production::production_get,
            production::production_select,
            shutdown::app_shutdown,
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !app.state::<shutdown::Shutdown>().approved.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    let _ = app.emit("app://confirm-exit", ());
                }
            }
        });
}
