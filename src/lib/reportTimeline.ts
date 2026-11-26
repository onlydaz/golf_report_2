import dayjs from "dayjs";
import type { ReportSummary, StickFilter } from "./db";

/** Generate only the visible six slots; empty slots still occupy their time on the axis. */
export function reportTimeline(report: ReportSummary | undefined, filter: StickFilter, requestedPage?: number) {
  const start = dayjs(filter.from).startOf("day");
  const end = dayjs(filter.to);
  const halfHour = start.isSame(end.subtract(1, "millisecond"), "day");
  const count = halfHour ? 48 : Math.max(1, end.startOf("day").diff(start, "day"));
  const pages = Math.ceil(count / 6);
  const source = halfHour
    ? (report?.halfHour ?? []).map((r) => ({ ...r, key: r.slot }))
    : (report?.daily ?? []).map((r) => ({ ...r, key: r.day }));
  const populated = source.filter((r) => r.total > 0);
  const latest = populated[populated.length - 1];
  const latestIndex = latest ? (halfHour ? dayjs(latest.key).diff(start, "minute") / 30 : dayjs(latest.key).diff(start, "day")) : 0;
  const current = Math.min(pages, Math.max(1, requestedPage ?? Math.floor(latestIndex / 6) + 1));
  const data = new Map(source.map((r) => [r.key, r]));
  const items = Array.from({ length: Math.min(6, count - (current - 1) * 6) }, (_, i) => {
    const index = (current - 1) * 6 + i;
    const from = halfHour ? start.add(index * 30, "minute") : start.add(index, "day");
    const to = halfHour ? from.add(30, "minute") : from.add(1, "day");
    const key = from.format(halfHour ? "YYYY-MM-DD HH:mm" : "YYYY-MM-DD");
    const row = data.get(key);
    return { from, to, label: from.format(halfHour ? "HH:mm" : "DD/MM"), total: row?.total ?? 0, ok: row?.ok ?? 0, ng: row?.ng ?? 0 };
  });
  return { halfHour, pages, current, items };
}
