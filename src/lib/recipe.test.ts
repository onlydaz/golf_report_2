import { describe, expect, it, vi } from "vitest";
import { confirmedRecipeHandshake, emptyPoint, matchActiveRecipe, recipeLoadsKg,
  recipeErrors, recipeApplyBlockReason, transferFailure, recipeApi } from "./recipe";
import type { Recipe, RecipeStation, RecipePlcStatus } from "./recipe";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";

const unset = (): RecipeStation => ({ enabled: null, numPoints: null, maxRot: null,
  settleTime: null, loadTol: null, bendTol: null, points: Array.from({ length: 10 }, emptyPoint) });
const valid = (): Recipe => ({ id: 1, customer: "TM", sku: "MH1253R", recipeRev: 0,
  updatedAt: "2026-01-01T00:00:00Z", configured: false, stations: {
    butt: { ...unset(), enabled: 1, numPoints: 4, maxRot: 0, settleTime: 0, loadTol: 0, bendTol: 0,
      points: Array.from({ length: 10 }, (_, i) => i >= 4 ? emptyPoint() : {
        posLinear: 0, posPressFixed: -1, posForce: 0, load: 100, bend: 1,
      }) }, tip: { ...unset(), enabled: 1, numPoints: 1, maxRot: 0, settleTime: 0, loadTol: 0, bendTol: 0,
      points: Array.from({ length: 10 }, (_, i) => i ? emptyPoint() : {
        posLinear: 0, posPressFixed: 0, posForce: 0, load: 100, bend: 1,
      }) },
  } });

describe("recipe validation and editing", () => {
  it("requires explicit Enable and used parameters without filling defaults", () => {
    const r = valid();
    expect(recipeErrors(r)).toEqual([]);
    r.stations.butt = unset();
    const original = JSON.stringify(r);
    expect(recipeErrors(r).length).toBeGreaterThan(0);
    expect(JSON.stringify(r)).toBe(original);
    r.stations.butt.enabled = 0;
    expect(recipeErrors(r)).toEqual([]);
    r.stations.butt.enabled = 2;
    expect(recipeErrors(r).length).toBeGreaterThan(0);
  });

  it("supports all ten indexes and preserves unused values when changing NumPoints or Enable", () => {
    const r = valid();
    for (const name of ["butt", "tip"] as const) {
      r.stations[name].numPoints = 10;
      r.stations[name].points = Array.from({ length: 10 }, (_, i) => ({ posLinear: i,
        posPressFixed: i + 10, posForce: i + 20, load: i + 30, bend: i + 40 }));
    }
    const original = JSON.stringify(r);
    expect(recipeErrors(r)).toEqual([]);
    expect(JSON.stringify(r)).toBe(original);
    r.stations.butt.points[9].load = null;
    expect(recipeErrors(r).length).toBeGreaterThan(0);
    r.stations.butt.numPoints = 9;
    expect(recipeErrors(r)).toEqual([]);
    expect(r.stations.butt.points[9].bend).toBe(49);
    r.stations.butt.enabled = 0;
    expect(recipeErrors(r)).toEqual([]);
    expect(r.stations.butt.points[9].bend).toBe(49);
  });

  it("requires positive load/bend and finite REAL values without inventing travel limits", () => {
    for (const v of [null, 0, -1, NaN, Infinity, 1e40, 1e-100]) {
      for (const field of ["load", "bend"] as const) {
        const r = valid(); r.stations.butt.points[0][field] = v;
        expect(recipeErrors(r).length).toBeGreaterThan(0);
      }
    }
    const r = valid(); r.stations.butt.points[0].posLinear = -100000;
    expect(recipeErrors(r)).toEqual([]);
    r.stations.butt.points[0].posForce = null;
    expect(recipeErrors(r).length).toBeGreaterThan(0);
    r.stations.tip.points[9].load = NaN;
    expect(recipeErrors(r)).toContain("TIP: thông số phải là số hữu hạn REAL 32 bit.");
  });

  it("checks integer ranges, SKU ASCII and both station tabs", () => {
    for (const [key, values] of Object.entries({ numPoints: [0, 11, 1.5], maxRot: [-1, 4, 0.1],
      settleTime: [-1, 32768, 0.5], loadTol: [-1], bendTol: [-1] })) {
      for (const value of values) {
        const r = valid(); Object.assign(r.stations.butt, { [key]: value });
        expect(recipeErrors(r).length).toBeGreaterThan(0);
      }
    }
    for (const sku of ["", " ", "MÃ", "A".repeat(21), "A\0B"]) {
      const r = valid(); r.sku = sku;
      expect(recipeErrors(r).length).toBeGreaterThan(0);
    }
    const r = valid(); r.stations.tip.maxRot = null;
    expect(recipeErrors(r).some(e => e.startsWith("TIP:"))).toBe(true);
  });
});

describe("recipe PLC transfer", () => {
  const status = (): RecipePlcStatus => ({ handshake: { pcCmd: 0, plcAck: 0, plcIdle: 1, actSku: "OLD", actRev: 2 },
    busy: false, needsReconcile: false, commissioned: true, maxWriteWords: 100,
    confirmationReference: "simulator", blockedReason: null, readError: null });
  const saved = () => ({ ...valid(), configured: true, recipeRev: 1 });

  it("uses only completed readable PLC handshakes as fresh active identities", () => {
    const s = status();
    expect(confirmedRecipeHandshake(s)).toEqual(s.handshake);
    expect(confirmedRecipeHandshake()).toBeUndefined();
    for (const patch of [{ busy: true }, { readError: "Timeout" }, { handshake: null },
      { handshake: { ...s.handshake!, pcCmd: 1 } }, { handshake: { ...s.handshake!, plcAck: 1 } }]) {
      expect(confirmedRecipeHandshake({ ...s, ...patch })).toBeUndefined();
    }
    // A fresh empty ActSKU must clear the previous identity, not fall back to a measured record.
    expect(confirmedRecipeHandshake({ ...s, handshake: { ...s.handshake!, actSku: "" } })?.actSku).toBe("");
  });

  it("requires exact SKU and revision before exposing saved parameters", () => {
    const r = saved();
    const h = { ...status().handshake!, actSku: r.sku, actRev: r.recipeRev };
    expect(matchActiveRecipe(h, r)).toBe(r);
    expect(matchActiveRecipe(h, { ...r, recipeRev: r.recipeRev + 1 })).toBeUndefined();
    expect(matchActiveRecipe({ ...h, actRev: h.actRev + 1 }, r)).toBeUndefined();
    expect(matchActiveRecipe({ ...h, actSku: "MH1144S" }, r)).toBeUndefined();
    expect(matchActiveRecipe(h, { ...r, configured: false })).toBeUndefined();
    expect(matchActiveRecipe(h)).toBeUndefined();
    expect(matchActiveRecipe(undefined, r)).toBeUndefined();
  });

  it("converts only used point loads from grams to kg and handles disabled stations", () => {
    const s = valid().stations.butt;
    s.numPoints = 3;
    s.points[0].load = 2500;
    s.points[1].load = 1250;
    s.points[2].load = 3750;
    s.points[9].load = 999999;
    expect(recipeLoadsKg(s)).toEqual([2.5, 1.25, 3.75]);
    expect(recipeLoadsKg({ ...s, enabled: 0 })).toEqual([]);
    expect(recipeLoadsKg()).toEqual([]);
    s.points[1].load = null;
    expect(recipeLoadsKg(s)).toEqual([]);
    expect(recipeLoadsKg(valid().stations.tip)).toEqual([0.1]);
  });

  it("gates apply on saved data, connections, commissioning and a ready handshake", () => {
    const r = saved();
    expect(recipeApplyBlockReason(r, false, true, true, false, status())).toBeNull();
    for (const [dirty, db, plc, busy] of [[true, true, true, false], [false, false, true, false],
      [false, true, false, false], [false, true, true, true]]) {
      expect(recipeApplyBlockReason(r, dirty, db, plc, busy, status())).not.toBeNull();
    }
    for (const patch of [{ commissioned: false }, { needsReconcile: true }, { busy: true },
      { handshake: null }, { readError: "Lỗi đọc" }, { maxWriteWords: null, blockedReason: "Chưa xác nhận giới hạn FC16" }]) {
      expect(recipeApplyBlockReason(r, false, true, true, false, { ...status(), ...patch })).not.toBeNull();
    }
    for (const patch of [{ plcIdle: 0 }, { plcAck: 1 }, { pcCmd: 1 }]) {
      const s = status(); s.handshake = { ...s.handshake!, ...patch };
      expect(recipeApplyBlockReason(r, false, true, true, false, s)).not.toBeNull();
    }
    expect(recipeApplyBlockReason(valid(), false, true, true, false, status())).not.toBeNull();
    const incomplete = saved(); incomplete.stations.butt.loadTol = null;
    expect(recipeApplyBlockReason(incomplete, false, true, true, false, status())).not.toBeNull();
  });

  it("allows 1-4 points on either station but blocks applying valid 5-10 point recipes", () => {
    for (const station of ["butt", "tip"] as const) {
      for (const count of [1, 2, 3, 4, 5, 10]) {
        const r = saved();
        r.stations[station] = { ...r.stations.butt, enabled: 1, numPoints: count,
          points: Array.from({ length: 10 }, () => ({ ...r.stations.butt.points[0] })) };
        expect(recipeErrors(r)).toEqual([]);
        const blocked = recipeApplyBlockReason(r, false, true, true, false, status());
        if (count <= 4) expect(blocked).toBeNull();
        else expect(blocked).toContain("mapping");
      }
    }
    const r = saved();
    r.stations.tip = { ...unset(), enabled: 0, numPoints: 10 };
    expect(recipeApplyBlockReason(r, false, true, true, false, status())).toBeNull();
  });

  it("distinguishes definite rejection from missing IPC evidence", () => {
    expect(transferFailure({ kind: "failed", message: "PLC từ chối" }).outcome).toBe("failed");
    expect(transferFailure({ kind: "unknown", message: "Timeout" }).outcome).toBe("unknown");
    expect(transferFailure("IPC disconnected").outcome).toBe("unknown");
  });

  it("sends only saved identity to apply and never transfers on save", async () => {
    const calls: { command: string; payload: unknown }[] = [];
    vi.stubGlobal("window", {});
    mockIPC((command, payload) => { calls.push({ command, payload }); return {}; });
    try {
      await recipeApi.apply("MH1253R", 7);
      expect(calls).toEqual([{ command: "recipe_apply", payload: { sku: "MH1253R", recipeRev: 7 } }]);
      calls.length = 0;
      await recipeApi.save(saved());
      expect(calls.map(call => call.command)).toEqual(["recipe_save"]);
    } finally { clearMocks(); vi.unstubAllGlobals(); }
  });
});
