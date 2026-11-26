import { describe, expect, it } from "vitest";
import { skuMismatch } from "./production";

describe("operator and PLC SKU comparison", () => {
  it("warns on different and empty PLC SKUs without using display zero as identity", () => {
    expect(skuMismatch("MH1253R", "MH1287S")).toContain("SKU không khớp");
    expect(skuMismatch("MH1253R", "")).toContain("PLC trả trống");
    expect(skuMismatch("", "MH1253R")).toContain("chưa chọn");
    expect(skuMismatch("MH1253R", "MH1253R")).toBeUndefined();
    expect(skuMismatch(undefined, "MH1253R")).toBeUndefined();
    expect(skuMismatch("MH1253R", undefined)).toBeUndefined();
  });
});
