import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BendChart, { bendScale, chartRowsForSku } from "./BendChart";
import type { StickRow } from "../lib/db";
import { emptyPoint, type Recipe } from "../lib/recipe";
import { fmtKg, fmtNum } from "../lib/format";

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

describe("active recipe chart", () => {
  const recipe = (): Recipe => ({ id: 1, customer: "TM", sku: "MH1253R", recipeRev: 7,
    configured: true, updatedAt: "2026-11-26T00:00:00Z", stations: {
      butt: { enabled: 1, numPoints: 2, maxRot: 0, settleTime: 1, loadTol: 0, bendTol: 0,
        points: Array.from({ length: 10 }, () => ({ ...emptyPoint(), load: 2500 })) },
      tip: { enabled: 0, numPoints: null, maxRot: null, settleTime: null, loadTol: null, bendTol: null,
        points: Array.from({ length: 10 }, emptyPoint) },
    } });
  const render = (r?: Recipe, note?: string) => renderToStaticMarkup(createElement(BendChart,
    { rows: [], loading: false, sku: "MH1253R", recipe: r, recipeNote: note }));

  it("filters exact active SKU before taking 30 and preserves stored bends and results", () => {
    const rows: StickRow[] = Array.from({ length: 70 }, (_, i) => ({ id: 70 - i, stickNo: i, recordSeq: i,
      productCode: i % 2 ? "MH1253R" : "MH1253R-OTHER", receivedAt: "2026-11-26T00:00:00Z",
      buttBends: [-5, 200, null, 150], tipBends: [4], buttResult: 1, tipResult: 2, overallResult: 2,
      buttLoadG: 2500, tipLoadG: 3000 }));
    const before = JSON.stringify(rows);
    const selected = chartRowsForSku(rows, "MH1253R");
    expect(selected).toHaveLength(30);
    expect(selected[0]).toBe(rows[1]);
    expect(selected[29]).toBe(rows[59]);
    expect(selected.every(r => r.productCode === "MH1253R")).toBe(true);
    expect(chartRowsForSku(rows)).toEqual([]);
    expect(chartRowsForSku(rows, "UNKNOWN")).toEqual([]);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("shows recipe metrics, valid zero values and uniform or varying loads in kg", () => {
    const r = recipe();
    const uniform = render(r);
    for (const label of ["Số điểm đo", "Lực đè cài đặt (kg)", "Dung sai độ cong (mm)", "Số lần xoay tối đa"]) {
      expect(uniform).toContain(label);
    }
    expect(uniform).toContain("2,500");
    expect(uniform).toContain("<b>0,00</b>");
    expect(uniform).toContain("<b>0</b>");
    r.stations.butt.points[1].load = 3500;
    expect(render(r)).toContain("2,500–3,500");
    r.stations.butt.enabled = 0;
    expect(render(r)).toContain("Trạm BUTT không sử dụng");
    expect(render(r)).not.toContain("2,500");
  });

  it("shows unsynchronized state without replacement parameters or limit warnings", () => {
    const html = render(undefined, "Chưa đồng bộ công thức");
    expect(html).toContain("Chưa đồng bộ công thức");
    expect(html).not.toContain("Vượt giới hạn");
    expect(html).not.toContain("Giới hạn độ cong");
    expect(html).not.toContain("Khoảng cách đẩy");
  });
});
