import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { StickRecord } from "./plc";

/** 0 not measured, 1 OK, 2 NG. */
export type ResultCode = number;

export interface DbStatus {
  connected: boolean;
  /** Last connect error; null while the first attempt is running or once connected. */
  error: string | null;
}

/** A record was saved (`db://saved`). */
export interface Saved {
  id: number;
  recordSeq: number;
  stickNo: number;
}

/** A record could not be saved (`db://error`). */
export interface DbError {
  recordSeq: number | null;
  message: string;
}

/** Same filter for every query. Dates are ISO strings; `to` is exclusive. */
export interface StickFilter {
  from?: string;
  to?: string;
  productCode?: string;
  stickNo?: number;
  result?: ResultCode;
  buttResult?: ResultCode;
  tipResult?: ResultCode;
}

export interface StickStats {
  total: number;
  ok: number;
  ng: number;
  buttOk: number;
  buttNg: number;
  tipOk: number;
  tipNg: number;
}

export interface StickRow {
  id: number;
  receivedAt: string;
  recordSeq: number;
  stickNo: number;
  productCode: string;
  overallResult: ResultCode;
  buttResult: ResultCode | null;
  buttLoadG: number | null;
  tipResult: ResultCode | null;
  tipLoadG: number | null;
  /** Bend (mm) of the deciding attempt per point P1..P4, null if not measured. */
  buttBends: (number | null)[];
  tipBends: (number | null)[];
}

export interface StickPage {
  items: StickRow[];
  total: number;
}

export interface SkuSummary {
  productCode: string;
  firstAt: string;
  lastAt: string;
  total: number;
  ok: number;
  ng: number;
  buttNg: number;
  tipNg: number;
}

export interface StickDetail {
  id: number;
  receivedAt: string;
  record: StickRecord;
}

/** `[measurement.butt|tip]` of config.toml. */
export interface StationSettings {
  loadKg: number | null;
  pushDistMm: number | null;
  bendMinMm: number | null;
  bendMaxMm: number | null;
  positionsMm: number[];
}

export interface AppInfo {
  startedAt: string;
  /** "ip:port" */
  plcAddr: string;
  measurement: { butt: StationSettings; tip: StationSettings };
}

export interface PointSummary {
  station: string; pointNo: number; positionMin: number | null; positionMax: number | null;
  /** loadG: raw PLC Load in g; pushDistMm: mean actual load in kg (legacy name). Display setpoint comes from measurement config. */
  loadG: number | null; pushDistMm: number | null; bendMm: number | null;
  samples: number; points: number; ok: number; ng: number;
}

export interface ReportSummary {
  stats: StickStats;
  retested: number;
  daily: { day: string; total: number; ok: number; ng: number }[];
  halfHour: { slot: string; total: number; ok: number; ng: number }[];
  points: PointSummary[];
  /** 0 below; 1..12 within inclusive limits; 13 above. */
  histogram: { pointNo: number; bucket: number; count: number }[];
  histogramLimits: [number, number] | null;
  bendDistribution: { pointNo: number; count: number; mean: number | null; sampleStdDev: number | null }[];
  invalidAttempts: number;
  generatedAt: string;
}

export interface ExportPoint {
  stickId: number; productCode: string; stickNo: number; station: string; pointNo: number;
  positionMm: number | null; result: number; attemptCount: number; decideAttempt: number;
}
export interface ExportAttempt {
  stickId: number; productCode: string; stickNo: number; station: string; pointNo: number;
  /** pushDistMm is raw actual load in kg for the current PLC; legacy name, no scaling. */
  attemptNo: number; pushDistMm: number | null; bendMm: number | null;
}
export interface ExportBatch {
  maxId: number; nextId: number | null; sticks: StickRow[]; points: ExportPoint[]; attempts: ExportAttempt[];
}

export const db = {
  status: () => invoke<DbStatus>("db_status"),
  appInfo: () => invoke<AppInfo>("app_info"),
  stats: (filter: StickFilter) => invoke<StickStats>("stick_stats", { filter }),
  list: (filter: StickFilter, page: number, pageSize: number) =>
    invoke<StickPage>("stick_list", { filter, page, pageSize }),
  skus: (filter: StickFilter) => invoke<SkuSummary[]>("sku_summary", { filter }),
  detail: (id: number) => invoke<StickDetail | null>("stick_detail", { id }),
  report: (filter: StickFilter) => invoke<ReportSummary>("report_summary", {
    filter, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }),
  exportBatch: (filter: StickFilter, afterId: number, maxId?: number) =>
    invoke<ExportBatch>("report_export_batch", { filter, afterId, maxId }),
};

export const onDbStatus = (cb: (s: DbStatus) => void): Promise<UnlistenFn> =>
  listen<DbStatus>("db://status", (e) => cb(e.payload));
export const onSaved = (cb: (s: Saved) => void): Promise<UnlistenFn> =>
  listen<Saved>("db://saved", (e) => cb(e.payload));
export const onDbError = (cb: (e: DbError) => void): Promise<UnlistenFn> =>
  listen<DbError>("db://error", (e) => cb(e.payload));

/** Command errors are plain strings from the backend. */
export const errorText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e));
