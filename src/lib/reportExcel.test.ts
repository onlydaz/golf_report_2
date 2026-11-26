import { afterEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { appendExportBatch, buildReportExcel, createReportWorkbook } from "./reportExcel";
import { db, type ExportBatch, type StickRow } from "./db";

const stick = (id: number): StickRow => ({ id, receivedAt: "2026-11-26T03:00:00Z", recordSeq: id, stickNo: 7,
  productCode: "=SKU", overallResult: 1, buttResult: 1, buttLoadG: 2500, tipResult: 2, tipLoadG: null,
  buttBends: [null, null, null, null], tipBends: [null, null, null, null] });
const batch = (): ExportBatch => ({ maxId: 2, nextId: null, sticks: [stick(1), stick(2)],
  points: [1, 2].flatMap((id) => ["BUTT", "TIP"].map((station) => ({ stickId: id, productCode: "=SKU", stickNo: 7,
    station, pointNo: station === "TIP" ? 4 : 1, positionMm: 0, result: 2, attemptCount: 2, decideAttempt: 2 }))),
  attempts: [1, 2].flatMap((id) => ["BUTT", "TIP"].flatMap((station) => [1, 2].map((attemptNo) => ({ stickId: id, productCode: "=SKU", stickNo: 7,
    station, pointNo: station === "TIP" ? 4 : 1, attemptNo, pushDistMm: 10.123456789, bendMm: attemptNo === 1 ? 0 : -0.25 })))),
});

afterEach(() => vi.restoreAllMocks());
describe("V2 workbook", () => {
  it("round-trips numeric values, real TIP P4 attempts, nulls, styles and text SKU", async () => {
    const book = createReportWorkbook();
    appendExportBatch(book, batch());
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(await book.xlsx.writeBuffer());
    const [s, p, a] = loaded.worksheets;
    expect(loaded.worksheets.map((w) => w.name)).toEqual(["Tổng hợp", "Điểm đo", "Lượt đo"]);
    expect([s.rowCount, p.rowCount, a.rowCount]).toEqual([3, 5, 9]);
    expect(s.getCell("H2").value).toBe(2.5);
    expect(s.getCell("H1").value).toBe("Lực đè cài đặt BUTT (kg)");
    expect(s.getCell("J1").value).toBe("Lực đè cài đặt TIP (kg)");
    expect(s.getCell("H2").numFmt).toBe("0.00");
    expect(s.getCell("J2").value).toBeNull();
    expect(s.getCell("B2").value).toBe("=SKU");
    expect(s.getCell("B2").type).toBe(ExcelJS.ValueType.String);
    expect(p.getCell("F2").value).toBe(0);
    expect(p.getCell("E3").value).toBe(4);
    expect(a.getCell("G2").value).toBe(10.123456789);
    expect(a.getCell("G1").value).toBe("Lực đè thực tế (kg)");
    expect(a.getCell("H3").value).toBe(-0.25);
    expect(a.getCell("G2").numFmt).toBe("0.00");
    expect(s.getRow(1).height).toBe(32);
    expect(s.getRow(2).height).toBe(26);
    expect(s.getCell("F2").fill).toMatchObject({ fgColor: { argb: "FFE3F5EB" } });
    expect(s.autoFilter).toBeTruthy();
    expect(p.autoFilter).toBeUndefined();
    expect(p.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
  });

  it("merges by database ID/station/point despite duplicate SKU and StickNo", () => {
    const book = createReportWorkbook(); appendExportBatch(book, batch());
    const [s, p, a] = book.worksheets;
    expect(s.model.merges).toEqual([]);
    expect(p.model.merges).toContain("A2:A3");
    expect(p.model.merges).toContain("A4:A5");
    expect(p.model.merges).not.toContain("A2:A5");
    expect(a.model.merges).toContain("D2:D3");
    expect(a.model.merges).toContain("D4:D5");
    expect(a.model.merges).toContain("E2:E3");
    expect(a.getCell("A6").value).toBe(2);
  });

  it("retains a stick with no points without fabricating child rows", () => {
    const book = createReportWorkbook(); appendExportBatch(book, { ...batch(), points: [], attempts: [] });
    expect(book.worksheets.map((s) => s.rowCount)).toEqual([3, 1, 1]);
  });

  it("exports every page with the applied filter and a fixed upper ID", async () => {
    const first = { ...batch(), nextId: 2, maxId: 3 };
    const last = { ...batch(), sticks: [stick(3)], points: [], attempts: [], maxId: 3 };
    const spy = vi.spyOn(db, "exportBatch").mockResolvedValueOnce(first).mockResolvedValueOnce(last);
    const filter = { productCode: "=SKU", result: 1 };
    const result = await buildReportExcel(filter, () => {});
    expect(result?.count).toBe(3);
    expect(spy.mock.calls).toEqual([[filter, 0, undefined], [filter, 2, 3]]);
  });

  it("returns no workbook when there are no matches", async () => {
    vi.spyOn(db, "exportBatch").mockResolvedValue({ maxId: 0, nextId: null, sticks: [], points: [], attempts: [] });
    expect(await buildReportExcel({}, () => {})).toBeNull();
  });

  it("propagates a failed batch rather than exporting a partial workbook", async () => {
    vi.spyOn(db, "exportBatch").mockResolvedValueOnce({ ...batch(), nextId: 2 }).mockRejectedValueOnce(new Error("read failed"));
    await expect(buildReportExcel({}, () => {})).rejects.toThrow("read failed");
  });
});
