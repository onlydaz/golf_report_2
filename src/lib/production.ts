import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface ProductionSelection { customer: "TM" | "MCC"; sku: string }
export interface ProductionSnapshot { selection: ProductionSelection | null; error: string | null; revision: number }
export const productionApi = {
  get: () => invoke<ProductionSnapshot>("production_get"),
  select: (customer: string, sku: string) => invoke<ProductionSnapshot>("production_select", { customer, sku }),
  onChanged: (cb: (value: ProductionSnapshot) => void) => listen<ProductionSnapshot>("production://changed", e => cb(e.payload)),
};

export function skuMismatch(selected: string | undefined, plcSku: string | undefined): string | undefined {
  if (selected === undefined || plcSku === undefined || selected === plcSku) return;
  return `SKU không khớp: đã chọn ${selected || "chưa chọn"}, PLC trả ${plcSku || "trống"}. Hãy kiểm tra trước khi tiếp tục sản xuất; kết quả lưu theo SKU đã chọn lúc nhận.`;
}
