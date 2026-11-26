import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BendChart, { bendScale } from "./BendChart";
import type { StationSettings, StickRow } from "../lib/db";
import type { StickRecord } from "../lib/plc";
import { fmtKg, fmtNum } from "../lib/format";

const latest = (): StickRecord => {
  const point = { result: 1, attemptCount: 2, decideAttempt: 2, position: 100,
    attempts: [{ pushDist: 999, bend: 500 }, { pushDist: 3.756, bend: 10 }] };
  return { version: 1, stickNo: 42, productCode: "OTHER-SKU", recordSeq: 42, overallResult: 1,
    status: { raw: 0, valid: true, buttChecked: true, tipChecked: true, overallOk: true }, raw: [],
    butt: { result: 1, pointCount: 2, ngPoint: 0, load: 2500,
      points: [structuredClone(point), structuredClone(point)] },
    tip: { result: 1, pointCount: 1, ngPoint: 0, load: 1500, points: [structuredClone(point)] } };
};
const reference: StationSettings = { loadKg: 999, pushDistMm: 999, positionsMm: [0, 125.5, 250, 375],
  bendMinMm: 50, bendMaxMm: 200 };
const render = (latestRecord?: StickRecord, rows: StickRow[] = [], station = reference) =>
  renderToStaticMarkup(createElement(BendChart, { rows, loading: false, latestRecord,
    settings: { butt: station, tip: station } }));

describe("bend scale and displayed measurements", () => {
  it("keeps negative measurements and both configured limits visible", () => {
    const { domain, ticks } = bendScale([-25, null, 220], [50, 200]);
    expect(domain[0]).toBeLessThan(-25);
    expect(domain[1]).toBeGreaterThan(220);
    expect(ticks).toContain(50); expect(ticks).toContain(200);
  });
  it("ignores non-finite measurements and produces a finite empty scale", () => {
    const { domain, ticks } = bendScale([NaN, Infinity, -Infinity, null], [undefined, null]);
    expect([...domain, ...ticks].every(Number.isFinite)).toBe(true);
  });
  it("formats two decimals and never substitutes zero for null", () => {
    expect(fmtKg(2500)).toBe("2,50");
    expect(fmtNum(105.5)).toBe("105,50");
    expect(fmtNum(0)).toBe("0,00");
    expect(fmtNum(null)).toBe("—"); expect(fmtKg(null)).toBe("—");
  });
});

describe("measurement chart without recipe dependencies", () => {
  it("uses configured grams and deciding actual kg from the latest measurement", () => {
    const r = latest();
    const before = JSON.stringify(r);
    const html = render(r);
    expect(html).toContain("Lực đè cài đặt (kg)");
    expect(html).toContain("Lực đè thực tế (kg)");
    expect(html).toContain("<b>2,50</b>");
    expect(html).toContain("<b>3,76</b>");
    expect(html).not.toContain("999,00");
    expect(html).not.toContain("Dung sai độ cong");
    expect(html).not.toContain("Chưa đồng bộ công thức");
    expect(JSON.stringify(r)).toBe(before);
  });

  it("shows the min-max of deciding values and ignores unmeasured points and invalid attempts", () => {
    const r = latest();
    r.butt.points[1].attempts[1].pushDist = 4.5;
    expect(render(r)).toContain("<b>3,76–4,50</b>");
    r.butt.pointCount = 1;
    expect(render(r)).toContain("<b>3,76</b>");
    r.butt.points[0].decideAttempt = 3;
    expect(render(r)).not.toContain("3,76");
    expect(render(r)).not.toContain("999,00");
  });

  it("uses config reference values without trailing zeroes and never uses its old push distance", () => {
    const html = render(latest());
    expect(html).toContain("<b>50–200</b>");
    expect(html).toContain("<b>0 · 125,5 · 250 · 375</b>");
    expect(html).toContain("Giới hạn tham chiếu từ config.toml");
    expect(html).not.toContain("50,00–200,00");
    expect(render(undefined, [], { ...reference, bendMinMm: 201 })).toContain("Chưa cấu hình");
    expect(render(undefined, [], { ...reference, bendMinMm: 0, bendMaxMm: null })).toContain("≥ 0");
    expect(render(undefined, [], { ...reference, bendMinMm: NaN })).toContain("≤ 200");
  });

  it("renders stored bends from different SKUs with no live identity or measurement", () => {
    const rows: StickRow[] = Array.from({ length: 30 }, (_, i) => ({ id: 30 - i, stickNo: i, recordSeq: i,
      productCode: i % 2 ? "SKU-A" : "SKU-B", receivedAt: "2026-11-26T00:00:00Z",
      buttBends: [-5, 200, null, 150], tipBends: [4], buttResult: 1, tipResult: 2, overallResult: 2,
      buttLoadG: 2500, tipLoadG: 3000 }));
    const before = JSON.stringify(rows);
    const html = render(undefined, rows);
    expect(html).toContain('class="bend-chart"');
    expect(html).not.toContain('class="bend-empty"');
    expect(html).not.toContain("Chưa xác định SKU");
    expect(html).not.toContain("Chưa đồng bộ công thức");
    expect(JSON.stringify(rows)).toBe(before);
    expect(render()).toContain("Chưa có dữ liệu độ cong đã lưu cho trạm BUTT");
  });
});
