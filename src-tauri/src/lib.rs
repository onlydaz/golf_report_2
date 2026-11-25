mod config;
mod db;
mod plc;

use tauri::{Emitter, Manager};

use config::AppConfig;
use plc::{commands::*, run_poller, spawn_plc_actor, PlcConfig, PollEvent};

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
            let app_cfg = AppConfig::load();
            // Saves records to Postgres; creates the database and tables if missing.
            let db_tx = db::spawn_writer(app_cfg.database, app.handle().clone());

            let cfg = PlcConfig::default();
            let poll_interval = cfg.poll_interval;
            let plc = spawn_plc_actor(cfg);

            // Forward connection status changes to the frontend.
            let mut status_rx = plc.subscribe_status();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    let status = status_rx.borrow_and_update().clone();
                    let _ = app_handle.emit("plc://status", status);
                    if status_rx.changed().await.is_err() {
                        break;
                    }
                }
            });

            // Poll the control area; read record [0] on DataReady 0 -> 1.
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(run_poller(plc.clone(), poll_interval, move |ev| {
                let _ = match ev {
                    PollEvent::Control(c) => app_handle.emit("plc://control", c),
                    PollEvent::Record(r) => {
                        if let Err(e) = db_tx.try_send(r.clone()) {
                            let _ = app_handle.emit(
                                "db://error",
                                db::DbError { record_seq: Some(r.record_seq), message: format!("save queue: {e}") },
                            );
                        }
                        app_handle.emit("plc://record", r)
                    }
                    PollEvent::Error(e) => app_handle.emit("plc://poll-error", e),
                };
            }));

            app.manage(plc);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            plc_status,
            plc_read_coils,
            plc_read_discrete_inputs,
            plc_read_holding_registers,
            plc_read_input_registers,
            plc_write_coil,
            plc_write_register,
            plc_write_coils,
            plc_write_registers,
            plc_read_control_area,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
