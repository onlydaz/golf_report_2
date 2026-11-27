import { invoke } from "@tauri-apps/api/core";

export type StationName = "butt" | "tip";
export interface RecipePoint {
  posLinear: number | null;
  posPressFixed: number | null;
  posForce: number | null;
  load: number | null;
  bend: number | null;
}
export interface RecipeStation {
  enabled: number | null;
  numPoints: number | null;
  maxRot: number | null;
  settleTime: number | null;
  loadTol: number | null;
  bendTol: number | null;
  points: RecipePoint[];
}
export interface RecipeSummary {
  id: number;
  customer: "TM" | "MCC";
  sku: string;
  recipeRev: number;
  updatedAt: string;
  configured: boolean;
}
export interface Recipe extends RecipeSummary {
  stations: Record<StationName, RecipeStation>;
}

export interface RecipeHandshake {
  pcCmd: number;
  plcAck: number;
  plcIdle: number;
  actSku: string;
  actRev: number;
}
export interface RecipePlcStatus {
  handshake: RecipeHandshake | null;
  busy: boolean;
  needsReconcile: boolean;
  commissioned: boolean;
  maxWriteWords: number | null;
  confirmationReference: string;
  blockedReason: string | null;
  readError: string | null;
}
export interface RecipeTransferReport {
  outcome: "success" | "failed" | "unknown";
  message: string;
  handshake?: RecipeHandshake;
}

/** An IPC failure is not evidence that the PLC rejected or never received a write. */
export function transferFailure(error: unknown): RecipeTransferReport {
  if (typeof error === "object" && error !== null && "kind" in error && "message" in error
    && (error.kind === "failed" || error.kind === "unknown") && typeof error.message === "string") {
    return { outcome: error.kind, message: error.message };
  }
  return { outcome: "unknown", message: "Mất phản hồi thao tác nạp. Chưa xác định kết quả; hãy đọc và đối chiếu trạng thái PLC trước khi nạp tiếp." };
}

export function recipeApplyBlockReason(recipe: Recipe | undefined, dirty: boolean,
  dbConnected: boolean, plcConnected: boolean, busy: boolean, status?: RecipePlcStatus): string | null {
  if (busy || status?.busy) return "Đang có thao tác công thức. Vui lòng chờ.";
  if (!dbConnected) return "Database chưa sẵn sàng.";
  if (!plcConnected) return "PLC chưa kết nối.";
  if (!status?.commissioned) return status?.blockedReason ?? "Đang đọc điều kiện cho phép nạp PLC.";
  if (status.blockedReason) return status.blockedReason;
  if (!recipe?.configured || recipe.recipeRev <= 0) return "Công thức chưa được thiết lập và lưu.";
  if (dirty) return "Cần lưu các thay đổi trước khi nạp PLC.";
  if (recipeErrors(recipe).length) return "Công thức đã lưu chưa hợp lệ.";
  if (Object.values(recipe.stations).some(s => s.enabled === 1 && (s.numPoints ?? 0) > 4)) {
    return "Chưa cho phép nạp quá 4 điểm mỗi trạm theo mapping kết quả đo hiện tại; cần kỹ thuật viên xác nhận mapping tương ứng.";
  }
  if (status.needsReconcile) return "Cần đối chiếu handshake trước khi nạp tiếp.";
  if (status.readError || !status.handshake) return status.readError ?? "Chưa đọc được trạng thái PLC.";
  const h = status.handshake;
  if (h.plcIdle !== 1 || h.plcAck !== 0 || h.pcCmd !== 0) return "PLC chưa cho phép đổi công thức hoặc handshake chưa sẵn sàng.";
  return null;
}

export const recipeApi = {
  list: () => invoke<RecipeSummary[]>("recipe_list"),
  get: (sku: string) => invoke<Recipe>("recipe_get", { sku }),
  save: (recipe: Recipe) => invoke<Recipe>("recipe_save", {
    recipe: { sku: recipe.sku, recipeRev: recipe.recipeRev, stations: recipe.stations },
  }),
  plcStatus: () => invoke<RecipePlcStatus>("recipe_plc_status"),
  apply: (sku: string, recipeRev: number) => invoke<RecipeTransferReport>("recipe_apply", { sku, recipeRev }),
  reconcile: () => invoke<RecipeTransferReport>("recipe_reconcile"),
};

export const emptyPoint = (): RecipePoint => ({
  posLinear: null, posPressFixed: null, posForce: null, load: null, bend: null,
});

const real = (value: number | null) => value !== null && Number.isFinite(value) && Number.isFinite(Math.fround(value));
const integer = (value: number | null, min: number, max: number) =>
  value !== null && Number.isInteger(value) && value >= min && value <= max;

/** UI feedback only; Rust repeats all validation before touching the database. */
export function recipeErrors(recipe: Recipe): string[] {
  const errors: string[] = [];
  if (!recipe.sku.trim() || recipe.sku.length > 20 || /[^\x01-\x7f]/.test(recipe.sku)) {
    errors.push("SKU phải có 1–20 ký tự ASCII, không chứa ký tự NUL.");
  }
  for (const name of ["butt", "tip"] as const) {
    const s = recipe.stations[name];
    const label = name.toUpperCase();
    if (s.points.length !== 10) errors.push(`${label}: phải có đúng 10 hàng điểm.`);
    const values = [s.loadTol, s.bendTol, ...s.points.flatMap(p => Object.values(p))];
    if (values.some(v => v !== null && !real(v))) errors.push(`${label}: thông số phải là số hữu hạn REAL 32 bit.`);
    if (s.enabled === 0) continue; // Disabled station: preserve values without requiring parameters.
    if (s.enabled !== 1) { errors.push(`${label}: chọn sử dụng hoặc bỏ qua trạm.`); continue; }
    if (!integer(s.numPoints, 1, 10)) errors.push(`${label}: số điểm đo phải từ 1 đến 10.`);
    if (!integer(s.maxRot, 0, 3)) errors.push(`${label}: số lần xoay tối đa phải từ 0 đến 3.`);
    if (!integer(s.settleTime, 0, 32767)) errors.push(`${label}: thời gian ổn định phải là số nguyên từ 0 đến 32767 (100 ms).`);
    if (!real(s.loadTol) || s.loadTol! < 0 || !real(s.bendTol) || s.bendTol! < 0) {
      errors.push(`${label}: nhập đủ hai dung sai không âm.`);
    }
    s.points.slice(0, s.numPoints ?? 0).forEach((p, i) => {
      if (![p.posLinear, p.posPressFixed, p.posForce].every(real)) errors.push(`${label} · P${i + 1}: nhập đủ ba vị trí (mm).`);
      if (![p.load, p.bend].every(v => real(v) && Math.fround(v!) > 0)) errors.push(`${label} · P${i + 1}: lực đè và độ cong phải lớn hơn 0 (REAL 32 bit).`);
    });
  }
  return errors;
}
