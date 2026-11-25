mod plc;

use tauri::{Emitter, Manager};

use plc::{commands::*, spawn_plc_actor, PlcConfig};

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
            let plc = spawn_plc_actor(PlcConfig::default());

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
