//! Tauri commands exposing the PLC actor to the frontend.

use tauri::State;

use super::control::ControlArea;
use super::registers::control as reg;
use super::{PlcError, PlcHandle, PlcStatus};

#[tauri::command]
pub fn plc_status(plc: State<'_, PlcHandle>) -> PlcStatus {
    plc.status()
}

#[tauri::command]
pub async fn plc_read_coils(plc: State<'_, PlcHandle>, addr: u16, count: u16) -> Result<Vec<bool>, PlcError> {
    plc.read_coils(addr, count).await
}

#[tauri::command]
pub async fn plc_read_discrete_inputs(
    plc: State<'_, PlcHandle>,
    addr: u16,
    count: u16,
) -> Result<Vec<bool>, PlcError> {
    plc.read_discrete_inputs(addr, count).await
}

#[tauri::command]
pub async fn plc_read_holding_registers(
    plc: State<'_, PlcHandle>,
    addr: u16,
    count: u16,
) -> Result<Vec<u16>, PlcError> {
    plc.read_holding_registers(addr, count).await
}

#[tauri::command]
pub async fn plc_read_input_registers(
    plc: State<'_, PlcHandle>,
    addr: u16,
    count: u16,
) -> Result<Vec<u16>, PlcError> {
    plc.read_input_registers(addr, count).await
}

#[tauri::command]
pub async fn plc_write_coil(plc: State<'_, PlcHandle>, addr: u16, value: bool) -> Result<(), PlcError> {
    plc.write_single_coil(addr, value).await
}

#[tauri::command]
pub async fn plc_write_register(plc: State<'_, PlcHandle>, addr: u16, value: u16) -> Result<(), PlcError> {
    plc.write_single_register(addr, value).await
}

#[tauri::command]
pub async fn plc_write_coils(plc: State<'_, PlcHandle>, addr: u16, values: Vec<bool>) -> Result<(), PlcError> {
    plc.write_multiple_coils(addr, values).await
}

#[tauri::command]
pub async fn plc_write_registers(
    plc: State<'_, PlcHandle>,
    addr: u16,
    values: Vec<u16>,
) -> Result<(), PlcError> {
    plc.write_multiple_registers(addr, values).await
}

/// Read and decode the control area D25000..D25019.
#[tauri::command]
pub async fn plc_read_control_area(plc: State<'_, PlcHandle>) -> Result<ControlArea, PlcError> {
    let words = plc.read_holding_registers(reg::START, reg::LEN).await?;
    ControlArea::decode(&words).ok_or_else(|| PlcError::Exception {
        code: 0,
        message: format!("expected {} registers, got {}", reg::LEN, words.len()),
    })
}
