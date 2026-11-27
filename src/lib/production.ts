import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface ProductionSelection { customer: "TM" | "MCC"; sku: string }
export interface ProductionSnapshot {
  selection: ProductionSelection | null; error: string | null; revision: number;
  sessionId: string; sessionStartedAt: string;
}
export const productionApi = {
  get: () => invoke<ProductionSnapshot>("production_get"),
  select: (customer: string, sku: string) => invoke<ProductionSnapshot>("production_select", { customer, sku }),
  onChanged: (cb: (value: ProductionSnapshot) => void) => listen<ProductionSnapshot>("production://changed", e => cb(e.payload)),
};
