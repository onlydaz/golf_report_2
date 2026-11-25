import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type PlcStatus =
  | { state: "connecting" }
  | { state: "connected" }
  | { state: "disconnected"; reason: string };

/** Error returned by every PLC command (rejected promise value). */
export interface PlcError {
  /** exception: PLC rejected the request (bad address...), still connected.
   *  disconnected: connection lost while the request was pending.
   *  not_connected: actor is reconnecting.
   *  actor_stopped: backend actor is gone. */
  kind: "exception" | "disconnected" | "not_connected" | "actor_stopped";
  message: string;
}

export const plc = {
  status: () => invoke<PlcStatus>("plc_status"),
  readCoils: (addr: number, count: number) => invoke<boolean[]>("plc_read_coils", { addr, count }),
  readDiscreteInputs: (addr: number, count: number) =>
    invoke<boolean[]>("plc_read_discrete_inputs", { addr, count }),
  readHoldingRegisters: (addr: number, count: number) =>
    invoke<number[]>("plc_read_holding_registers", { addr, count }),
  readInputRegisters: (addr: number, count: number) =>
    invoke<number[]>("plc_read_input_registers", { addr, count }),
  writeCoil: (addr: number, value: boolean) => invoke<void>("plc_write_coil", { addr, value }),
  writeRegister: (addr: number, value: number) => invoke<void>("plc_write_register", { addr, value }),
  writeCoils: (addr: number, values: boolean[]) => invoke<void>("plc_write_coils", { addr, values }),
  writeRegisters: (addr: number, values: number[]) =>
    invoke<void>("plc_write_registers", { addr, values }),
};

/** Subscribe to connection status changes. */
export function onPlcStatus(cb: (status: PlcStatus) => void): Promise<UnlistenFn> {
  return listen<PlcStatus>("plc://status", (e) => cb(e.payload));
}

/** Decoded control area D25000..D25019 (see docs/X212PI-Register-Mapping-PLC-Software.xlsx). */
export interface ControlArea {
  formatVersion: number;
  recordSize: number;
  bufferCount: number;
  writeIdx: number;
  totalCount: number;
  lastIdx: number;
  heartbeat: number;
  pcReadCount: number;
  pcHeartbeat: number;
  dataReady: number;
  pcReadDone: number;
  /** Raw words D25000..D25019. */
  raw: number[];
}

export const readControlArea = () => invoke<ControlArea>("plc_read_control_area");
