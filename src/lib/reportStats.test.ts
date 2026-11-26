import { describe, expect, it } from "vitest";
import { referenceCpk } from "./reportStats";

describe("reference Cpk", () => {
  it("uses the nearer limit and retains negative capability", () => {
    expect(referenceCpk(10, 120, 20, [50, 200])).toBeCloseTo(70 / 60);
    expect(referenceCpk(10, 210, 20, [50, 200])).toBeCloseTo(-10 / 60);
  });
  it("requires multiple samples, nonzero sample deviation and valid limits", () => {
    expect(referenceCpk(1, 100, null, [50, 200])).toBeNull();
    expect(referenceCpk(2, 100, 0, [50, 200])).toBeNull();
    expect(referenceCpk(2, NaN, 10, [50, 200])).toBeNull();
    expect(referenceCpk(2, 100, 10, [200, 50])).toBeNull();
    expect(referenceCpk(2, 100, 10, null)).toBeNull();
  });
});
