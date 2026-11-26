const pad = (n: number) => String(n).padStart(2, "0");

export const CONFIGURED_LOAD_SOURCE = "Theo measurement trong config.toml hiện tại; không phải Load PLC hoặc cấu hình tại thời điểm đo.";

/** "25/11/2026 10:21:03", local time. */
export function fmtDateTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${fmtTime(d)}`;
}

/** "10:21:03", local time. */
export function fmtTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Vietnamese number with a fixed number of decimals ("121,4"); "—" for missing values. */
export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("vi-VN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Integer with thousands separator ("9.012"). */
export const fmtInt = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("vi-VN"));

/** Load in kg from grams as stored by the PLC. */
export const fmtKg = (g: number | null | undefined) => fmtNum(g == null ? null : g / 1000, 2);

/** "95,5%" of `part` in `total`. */
export const fmtRate = (part: number, total: number) =>
  `${(total ? (part * 100) / total : 0).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
