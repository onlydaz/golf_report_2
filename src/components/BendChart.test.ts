import { describe, expect, it } from "vitest";
import { bendScale } from "./BendChart";
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
