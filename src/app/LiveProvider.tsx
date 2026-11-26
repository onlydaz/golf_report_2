import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { db, errorText, onDbError, onDbStatus, onSaved, type AppInfo, type DbStatus } from "../lib/db";
import { confirmedRecipeHandshake, matchActiveRecipe, recipeApi, type Recipe, type RecipeHandshake, type RecipePlcStatus } from "../lib/recipe";
import { useQuery } from "../lib/useQuery";
import {
  onControlArea,
  onPlcStatus,
  onPollError,
  onRecord,
  plc,
  getPlcDiagnostics, onPlcDiagnostics, clearPlcConnectionLog, type PlcDiagnostics,
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
const RecipeContext = createContext<{
  status?: RecipePlcStatus;
  confirmed?: { handshake: RecipeHandshake; readAt: Date };
  isLive: boolean;
  customer?: string;
  recipe?: Recipe;
  recipeError: string;
  applying: boolean;
  setApplying: (value: boolean) => void;
  refreshRecipe: () => void;
} | null>(null);
const DiagnosticsContext = createContext<{
  diagnostics: PlcDiagnostics | null; diagnosticsError: string; clearLog: () => Promise<void>;
} | null>(null);
const ControlContext = createContext<LiveControl>({ control: null, lastPoll: null, pollError: null });

export function LiveProvider({ children }: { children: ReactNode }) {
  const [plcStatus, setPlcStatus] = useState<PlcStatus | null>(null);
  const [dbStatus, setDbStatus] = useState<DbStatus>({ connected: false, error: null });
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [last, setLast] = useState<LiveRecord | null>(null);
  const [savedTick, setSavedTick] = useState(0);
  const [recipeApplying, setRecipeApplying] = useState(false);
  const [recipeSnapshot, setRecipeSnapshot] = useState<{ connection: PlcStatus; status: RecipePlcStatus }>();
  const recipeRead = useRef<Promise<RecipePlcStatus> | undefined>(undefined);
  const [confirmedRecipe, setConfirmedRecipe] = useState<{ handshake: RecipeHandshake; readAt: Date }>();
  const [recipeRefresh, setRecipeRefresh] = useState(0);
  const refreshRecipe = useCallback(() => setRecipeRefresh(n => n + 1), []);
  const setApplying = useCallback((value: boolean) => {
    setRecipeSnapshot(undefined); // A completed transfer needs a fresh read, even on the same connection.
    setRecipeApplying(value);
  }, []);
  const recipeStatus = !recipeApplying && plcStatus?.state === "connected" && recipeSnapshot?.connection === plcStatus
    ? recipeSnapshot.status : undefined;

  // One shared read loop for all pages. No reads while disconnected or transferring.
  useEffect(() => {
    if (plcStatus?.state !== "connected" || recipeApplying) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        // A previous effect may still have a read in flight; discard it before starting another.
        await recipeRead.current?.catch(() => undefined);
        if (!active) return;
        const request = recipeApi.plcStatus();
        recipeRead.current = request;
        const status = await request;
        if (!active) return;
        setRecipeSnapshot({ connection: plcStatus, status });
        const handshake = confirmedRecipeHandshake(status);
        if (handshake) setConfirmedRecipe({ handshake, readAt: new Date() });
      } catch (e) {
        if (active) setRecipeSnapshot({ connection: plcStatus, status: {
          handshake: null, busy: false, needsReconcile: false, commissioned: false,
          maxWriteWords: null, confirmationReference: "",
          blockedReason: `Không đọc được điều kiện nạp PLC: ${errorText(e)}`, readError: errorText(e),
        } });
      } finally {
        if (active) timer = setTimeout(poll, 2000);
      }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [plcStatus, recipeApplying]);

  const activeSku = confirmedRecipe?.handshake.actSku;
  const activeRev = confirmedRecipe?.handshake.actRev;
  // DB queries follow identity, save and connection changes, not each PLC poll or measurement.
  const activeRecipe = useQuery(dbStatus.connected && !!activeSku && !recipeApplying,
    () => recipeApi.get(activeSku!), [activeSku, activeRev, recipeRefresh, plcStatus], false);
  const [diagnostics, setDiagnostics] = useState<PlcDiagnostics | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState("");
  const receiveDiagnostics = (next: PlcDiagnostics) => {
    setDiagnostics((previous) => !previous || next.revision >= previous.revision ? next : previous);
    setDiagnosticsError("");
  };
  const clearLog = async () => { receiveDiagnostics(await clearPlcConnectionLog()); };
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    // Subscribe first, then retrieve startup history. Revision prevents an older snapshot overwriting an event.
    void (async () => {
      try {
        const off = await onPlcDiagnostics((d) => { if (!disposed) receiveDiagnostics(d); });
        if (disposed) { off(); return; }
        unlisten = off;
        const snapshot = await getPlcDiagnostics();
        if (!disposed) receiveDiagnostics(snapshot);
      } catch (e) { if (!disposed) setDiagnosticsError(String(e)); }
    })();
    return () => { disposed = true; unlisten?.(); };
  }, []);
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
  const liveRecipe = useMemo(() => ({ status: recipeStatus, confirmed: confirmedRecipe,
    isLive: !!confirmedRecipeHandshake(recipeStatus), customer: activeRecipe.data?.customer,
    recipe: matchActiveRecipe(confirmedRecipe?.handshake, activeRecipe.data), recipeError: activeRecipe.error,
    applying: recipeApplying, setApplying, refreshRecipe }),
  [recipeStatus, confirmedRecipe, activeRecipe.data, activeRecipe.error, recipeApplying, setApplying, refreshRecipe]);
  return (
    <LiveContext.Provider value={live}>
      <ControlContext.Provider value={control}>
        <DiagnosticsContext.Provider value={{ diagnostics, diagnosticsError, clearLog }}>
          <RecipeContext.Provider value={liveRecipe}>
            {children}
          </RecipeContext.Provider>
        </DiagnosticsContext.Provider>
      </ControlContext.Provider>
    </LiveContext.Provider>
  );
}

export function useLive(): Live {
  const v = useContext(LiveContext);
  if (!v) throw new Error("useLive outside LiveProvider");
  return v;
}

export const useControl = () => useContext(ControlContext);
export function useLiveRecipe() {
  const value = useContext(RecipeContext);
  if (!value) throw new Error("useLiveRecipe outside LiveProvider");
  return value;
}
export function usePlcDiagnostics() {
  const value = useContext(DiagnosticsContext);
  if (!value) throw new Error("usePlcDiagnostics outside LiveProvider");
  return value;
}
