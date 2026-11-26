import { useLocation, useNavigate, type Location } from "react-router";
import type { StickRecord } from "./plc";

export type StickSource = { id: number } | { record: StickRecord; receivedAt: Date | string; plcProductCode?: string };
export interface MeasurementNavigation {
  background?: Location;
  source?: StickSource;
  scrollTop?: number;
}

export function useOpenStick() {
  const navigate = useNavigate();
  const location = useLocation();
  return (source: StickSource) => navigate(`/measurements/${"id" in source ? source.id : "live"}`, {
    state: { background: location, source, scrollTop: document.querySelector(".main-content")?.scrollTop ?? 0 } satisfies MeasurementNavigation,
  });
}
