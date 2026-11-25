import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { db, onDbError, onDbStatus, onSaved, type AppInfo, type DbStatus } from "../lib/db";
import {
  onControlArea,
  onPlcStatus,
  onPollError,
  onRecord,
  plc,
  type ControlArea,
  type PlcError,
  type PlcStatus,
  type StickRecord,
} from "../lib/plc";
import { useEvents } from "../lib/useEvents";

export type SaveState =
  | { state: "pending" }
  | { state: "saved"; id: number }
  | { state: "error"; message: string };

/** Last record read from the PLC in this run, with its save outcome. */
export interface LiveRecord {
  record: StickRecord;
  receivedAt: Date;
  save: SaveState;
}

interface Live {
  plcStatus: PlcStatus | null;
  dbStatus: DbStatus;
  info: AppInfo | null;
  last: LiveRecord | null;
  /** Incremented on every `db://saved`, so pages can re-query. */
  savedTick: number;
}

/** Changes every poll (500 ms): kept apart so pages that do not show it are not re-rendered. */
interface LiveControl {
  control: ControlArea | null;
  lastPoll: Date | null;
  pollError: PlcError | null;
}

const LiveContext = createContext<Live | null>(null);
const ControlContext = createContext<LiveControl>({ control: null, lastPoll: null, pollError: null });

export function LiveProvider({ children }: { children: ReactNode }) {
  const [plcStatus, setPlcStatus] = useState<PlcStatus | null>(null);
  const [dbStatus, setDbStatus] = useState<DbStatus>({ connected: false, error: null });
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [last, setLast] = useState<LiveRecord | null>(null);
  const [savedTick, setSavedTick] = useState(0);
  const [control, setControl] = useState<LiveControl>({ control: null, lastPoll: null, pollError: null });

  useEffect(() => {
    plc.status().then(setPlcStatus).catch(() => undefined);
    db.status().then(setDbStatus).catch(() => undefined);
    db.appInfo().then(setInfo).catch(() => undefined);
  }, []);

  useEvents(() => [
    onPlcStatus(setPlcStatus),
    onControlArea((c) => setControl({ control: c, lastPoll: new Date(), pollError: null })),
    onPollError((e) => setControl((prev) => ({ ...prev, pollError: e }))),
    onRecord((record) => setLast({ record, receivedAt: new Date(), save: { state: "pending" } })),
    onDbStatus(setDbStatus),
    onSaved((s) => {
      setLast((l) => (l && l.record.recordSeq === s.recordSeq ? { ...l, save: { state: "saved", id: s.id } } : l));
      setSavedTick((t) => t + 1);
    }),
    onDbError((e) =>
      setLast((l) =>
        l && l.record.recordSeq === e.recordSeq ? { ...l, save: { state: "error", message: e.message } } : l,
      ),
    ),
  ]);

  const live = useMemo(
    () => ({ plcStatus, dbStatus, info, last, savedTick }),
    [plcStatus, dbStatus, info, last, savedTick],
  );
  return (
    <LiveContext.Provider value={live}>
      <ControlContext.Provider value={control}>{children}</ControlContext.Provider>
    </LiveContext.Provider>
  );
}

export function useLive(): Live {
  const v = useContext(LiveContext);
  if (!v) throw new Error("useLive outside LiveProvider");
  return v;
}

export const useControl = () => useContext(ControlContext);
