//! Authorized PLC diagnostics. Raw writes are not exposed over IPC; recipes must use the validated handshake.

use crate::{auth::Auth, db::DbPool};
use tauri::State;

use super::control::{ControlArea, read_control_area};
use super::{PlcHandle, PlcStatus, write_pc_read_count};

#[tauri::command]
pub async fn plc_status(
    auth: State<'_, Auth>,
    db: State<'_, DbPool>,
    plc: State<'_, PlcHandle>,
) -> Result<PlcStatus, String> {
    let _access = auth.require(&db, false).await?;
    Ok(plc.status())
}

#[tauri::command]
pub async fn plc_read_coils(
    auth: State<'_, Auth>,
    db: State<'_, DbPool>,
    plc: State<'_, PlcHandle>,
    addr: u16,
    count: u16,
) -> Result<Vec<bool>, String> {
    let _access = auth.require(&db, true).await?;
    plc.read_coils(addr, count).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn plc_read_discrete_inputs(
    auth: State<'_, Auth>,
    db: State<'_, DbPool>,
    plc: State<'_, PlcHandle>,
    addr: u16,
    count: u16,
) -> Result<Vec<bool>, String> {
    let _access = auth.require(&db, true).await?;
    plc.read_discrete_inputs(addr, count)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn plc_read_holding_registers(
    auth: State<'_, Auth>,
    db: State<'_, DbPool>,
    plc: State<'_, PlcHandle>,
    addr: u16,
    count: u16,
) -> Result<Vec<u16>, String> {
    let _access = auth.require(&db, true).await?;
    plc.read_holding_registers(addr, count)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn plc_read_input_registers(
    auth: State<'_, Auth>,
    db: State<'_, DbPool>,
    plc: State<'_, PlcHandle>,
    addr: u16,
    count: u16,
) -> Result<Vec<u16>, String> {
    let _access = auth.require(&db, true).await?;
    plc.read_input_registers(addr, count)
        .await
        .map_err(|e| e.to_string())
}

/// Read and decode the control area D25000..D25019.
#[tauri::command]
pub async fn plc_read_control_area(
    auth: State<'_, Auth>,
    db: State<'_, DbPool>,
    plc: State<'_, PlcHandle>,
) -> Result<ControlArea, String> {
    let _access = auth.require(&db, true).await?;
    read_control_area(&plc).await.map_err(|e| e.to_string())
}

/// Reset PC_ReadCount (D25008..D25009) to 0.
#[tauri::command]
pub async fn plc_reset_read_count(
    auth: State<'_, Auth>,
    db: State<'_, DbPool>,
    plc: State<'_, PlcHandle>,
) -> Result<(), String> {
    let _access = auth.require(&db, true).await?;
    write_pc_read_count(&plc, 0)
        .await
        .map_err(|e| e.to_string())
}
