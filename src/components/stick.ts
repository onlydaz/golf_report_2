import type { Point, Station, StickRecord } from "../lib/plc";

export type StationKey = "BUTT" | "TIP";

export const stationOf = (r: StickRecord, key: StationKey): Station => (key === "BUTT" ? r.butt : r.tip);

const clampCount = (n: number) => Math.min(Math.max(n, 0), 4);

/** Points actually measured (the PLC fills `pointCount` of the 4 slots). */
export const measuredPoints = (s: Station): Point[] => s.points.slice(0, clampCount(s.pointCount));

/** Number of attempts actually made at a point. */
export const attemptCount = (p: Point) => clampCount(p.attemptCount);

/** The attempt that decided the point's result, if `decideAttempt` is valid. */
export const decidingAttempt = (p: Point) =>
  p.decideAttempt >= 1 && p.decideAttempt <= attemptCount(p) ? p.attempts[p.decideAttempt - 1] : undefined;
