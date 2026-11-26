import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type PlcStatus =
  | { state: "connecting" }
  | { state: "connected" }
  | { state: "disconnected"; reason: string };

export interface PlcDiagnostics {
  revision: number;
  ip: string;
  port: number;
  unitId: number;
  status: PlcStatus;
  connectedAt: string | null;
  readLatencyMs: number | null;
  day: string;
  readErrorsToday: number;
  disconnectsToday: number;
  logs: { at: string; tone: "connected" | "disconnected" | "connecting"; message: string; address: string }[];
}

export const getPlcDiagnostics = () => invoke<PlcDiagnostics>("plc_diagnostics");
export const clearPlcConnectionLog = () => invoke<PlcDiagnostics>("plc_clear_connection_log");
export const onPlcDiagnostics = (cb: (d: PlcDiagnostics) => void) => listen<PlcDiagnostics>("plc://diagnostics", (e) => cb(e.payload));

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

/** Write 0 to PC_ReadCount (D25008..D25009). */
export const resetReadCount = () => invoke<void>("plc_reset_read_count");

/** Live control area, emitted by the backend poller every poll interval. */
export function onControlArea(cb: (c: ControlArea) => void): Promise<UnlistenFn> {
  return listen<ControlArea>("plc://control", (e) => cb(e.payload));
}

/** Read error from the backend poller (the loop keeps running). */
export function onPollError(cb: (e: PlcError) => void): Promise<UnlistenFn> {
  return listen<PlcError>("plc://poll-error", (e) => cb(e.payload));
}

export interface Attempt {
  /** mm */ pushDist: number;
  /** mm */ bend: number;
}

export interface Point {
  /** 0 not measured, 1 OK, 2 NG */
  result: number;
  attemptCount: number;
  decideAttempt: number;
  /** mm */ position: number;
  attempts: Attempt[];
}

export interface Station {
  /** 0 not measured, 1 OK, 2 NG */
  result: number;
  pointCount: number;
  ngPoint: number;
  /** g */ load: number;
  points: Point[];
}

/** Decoded record [0] (D25020..D25259), sheet Cau_truc_ban_ghi. */
export interface StickRecord {
  version: number;
  status: { raw: number; valid: boolean; buttChecked: boolean; tipChecked: boolean; overallOk: boolean };
  stickNo: number;
  productCode: string;
  /** 0 none, 1 OK, 2 NG */
  overallResult: number;
  recordSeq: number;
  butt: Station;
  tip: Station;
  raw: number[];
}

/** Record [0], emitted when DataReady goes 0 -> 1. */
export function onRecord(cb: (r: StickRecord) => void): Promise<UnlistenFn> {
  return listen<StickRecord>("plc://record", (e) => cb(e.payload));
}
