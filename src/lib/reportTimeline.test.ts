import { describe, expect, it } from "vitest";
import type { ReportSummary } from "./db";
import { reportTimeline } from "./reportTimeline";

const report = (data: Partial<ReportSummary>) => data as ReportSummary;
describe("report timeline", () => {
  it("fills 48 half-hour slots and defaults to the page of the latest record", () => {
    const filter = { from: "2026-11-26T00:00:00", to: "2026-11-27T00:00:00" };
    const data = report({ halfHour: [{ slot: "2026-11-26 10:30", total: 1, ok: 1, ng: 0 }] });
    const window = reportTimeline(data, filter);
    expect(window.halfHour).toBe(true);
    expect(window.pages).toBe(8);
    expect(window.current).toBe(4);
    expect(window.items.map((r) => r.label)).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"]);
    expect(window.items.map((r) => r.total)).toEqual([0, 0, 0, 1, 0, 0]);
    expect(reportTimeline(data, filter, 8).items[5].to.format("YYYY-MM-DD HH:mm")).toBe("2026-11-27 00:00");
  });
  it("fills missing days, paginates by six and includes records with other results", () => {
    const filter = { from: "2026-11-20T00:00:00", to: "2026-11-27T00:00:00" };
    const data = report({ daily: [{ day: "2026-11-26", total: 1, ok: 0, ng: 0 }] });
    const window = reportTimeline(data, filter);
    expect(window.halfHour).toBe(false);
    expect(window.current).toBe(2);
    expect(window.items).toHaveLength(1);
    expect(reportTimeline(data, filter, 1).items).toHaveLength(6);
    expect(reportTimeline(data, filter, 1).items.every((r) => r.total === 0)).toBe(true);
  });
  it("provides a complete zero-filled first page without data", () => {
    const window = reportTimeline(undefined, { from: "2026-11-26T00:00:00", to: "2026-11-27T00:00:00" });
    expect(window.current).toBe(1);
    expect(window.items).toHaveLength(6);
    expect(window.items.every((r) => r.ok === 0 && r.ng === 0)).toBe(true);
  });
});
