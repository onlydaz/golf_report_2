import ExcelJS from "exceljs";
import type { ExportBatch, StickFilter } from "./db";
import { db } from "./db";
import { PLC_LOAD_SOURCE, fmtDateTime } from "./format";
import { resultLabel } from "../components/Result";
import type { ReportChartImage } from "./reportChartImages";

const MAX_ROWS = 1_048_576;
const numeric = (v: number | null) => v != null && Number.isFinite(v) ? v : null;
const kg = (g: number | null) => g == null ? null : numeric(g / 1000);

function sheet(book: ExcelJS.Workbook, name: string, headers: string[]) {
  const s = book.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1, showGridLines: false }] });
  s.addRow(headers);
  s.columns.forEach((c, i) => { c.width = Math.min(40, Math.max(14, headers[i].length + 4)); });
  const row = s.getRow(1);
  row.height = 32;
  row.eachCell((c) => {
    c.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF123B5D" } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = { bottom: { style: "thin", color: { argb: "FFB8C9DA" } } };
  });
  return s;
}

function addRow(s: ExcelJS.Worksheet, values: ExcelJS.CellValue[], decimals: number[], results: number[]) {
  if (s.rowCount >= MAX_ROWS) throw new Error("Dữ liệu vượt giới hạn dòng Excel. Hãy chọn khoảng thời gian ngắn hơn.");
  const row = s.addRow(values);
  row.height = 26;
  row.eachCell({ includeEmpty: true }, (c, col) => {
    c.font = { name: "Calibri", size: 11, color: { argb: "FF243B53" } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: row.number % 2 === 0 ? "FFFFFFFF" : "FFF3F7FB" } };
    c.border = { bottom: { style: "hair", color: { argb: "FFE1E8EF" } } };
    if (decimals.includes(col)) c.numFmt = "0.00";
    if (results.includes(col) && (c.value === "OK" || c.value === "NG")) {
      c.font = { ...c.font, bold: true, color: { argb: c.value === "OK" ? "FF167451" : "FFB43F49" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.value === "OK" ? "FFE3F5EB" : "FFFFEBEB" } };
    }
    const column = s.getColumn(col);
    column.width = Math.min(40, Math.max(column.width ?? 14, String(c.value ?? "").length + 3));
  });
}

/** Merge using original rows, never cell values already replaced by a merge. */
function mergeGroups<T>(s: ExcelJS.Worksheet, rows: T[], startRow: number, key: (r: T) => string, columns: number[]) {
  for (let start = 0; start < rows.length;) {
    let end = start + 1;
    while (end < rows.length && key(rows[end]) === key(rows[start])) end++;
    if (end - start > 1) columns.forEach((c) => s.mergeCells(startRow + start, c, startRow + end - 1, c));
    start = end;
  }
}

/** A complete stick belongs to one batch, so merged groups never cross batch boundaries. */
export function appendExportBatch(book: ExcelJS.Workbook, batch: ExportBatch) {
  const [summary, points, attempts] = book.worksheets;
  batch.sticks.forEach((r) => addRow(summary, [r.id, r.productCode, r.stickNo, fmtDateTime(r.receivedAt), r.recordSeq,
    resultLabel(r.overallResult), r.buttResult == null ? null : resultLabel(r.buttResult), kg(r.buttLoadG),
    r.tipResult == null ? null : resultLabel(r.tipResult), kg(r.tipLoadG)], [8, 10], [6, 7, 9]));
  const pointStart = points.rowCount + 1;
  batch.points.forEach((p) => addRow(points, [p.stickId, p.productCode, p.stickNo, p.station, p.pointNo,
    numeric(p.positionMm), resultLabel(p.result), p.attemptCount, p.decideAttempt], [6], [7]));
  const attemptStart = attempts.rowCount + 1;
  // Legacy pushDistMm contains actual load in kg from the current PLC: export unchanged.
  batch.attempts.forEach((a) => addRow(attempts, [a.stickId, a.productCode, a.stickNo, a.station, a.pointNo,
    a.attemptNo, numeric(a.pushDistMm), numeric(a.bendMm)], [7, 8], []));
  mergeGroups(points, batch.points, pointStart, (r) => String(r.stickId), [1, 2, 3]);
  mergeGroups(points, batch.points, pointStart, (r) => `${r.stickId}/${r.station}`, [4]);
  mergeGroups(attempts, batch.attempts, attemptStart, (r) => String(r.stickId), [1, 2, 3]);
  mergeGroups(attempts, batch.attempts, attemptStart, (r) => `${r.stickId}/${r.station}`, [4]);
  mergeGroups(attempts, batch.attempts, attemptStart, (r) => `${r.stickId}/${r.station}/${r.pointNo}`, [5]);
  summary.autoFilter = { from: { row: 1, column: 1 }, to: { row: summary.rowCount, column: 10 } };
}

export function createReportWorkbook() {
  const book = new ExcelJS.Workbook();
  book.creator = "Phần Mềm Thu Thập Dữ Liệu Độ Cong Gậy Golf";
  book.created = new Date();
  sheet(book, "Tổng hợp", ["Mã phép đo", "Mã sản phẩm", "Số gậy", "Thời gian nhận", "RecordSeq", "Kết quả tổng thể", "Kết quả BUTT", "Lực đè cài đặt BUTT (kg)", "Kết quả TIP", "Lực đè cài đặt TIP (kg)"]);
  sheet(book, "Điểm đo", ["Mã phép đo", "Mã sản phẩm", "Số gậy", "Trạm đo", "Điểm đo", "Vị trí đo (mm)", "Kết quả", "Số lượt đo", "Lượt quyết định"]);
  sheet(book, "Lượt đo", ["Mã phép đo", "Mã sản phẩm", "Số gậy", "Trạm đo", "Điểm đo", "Lượt đo", "Lực đè thực tế (kg)", "Độ cong (mm)"]);
  for (const column of ["H1", "J1"]) book.worksheets[0].getCell(column).note = PLC_LOAD_SOURCE;
  for (const s of book.worksheets.slice(1)) s.getCell("A1").note = "Các dòng được gộp theo mã phép đo, trạm và điểm. Dùng sheet Tổng hợp để lọc/sắp xếp.";
  return book;
}

export async function buildReportExcel(filter: StickFilter, onProgress: (count: number) => void,
  charts?: { label: string; images: AsyncIterable<ReportChartImage> }) {
  const book = createReportWorkbook();
  let afterId = 0;
  let maxId: number | undefined;
  let count = 0;
  do {
    const batch = await db.exportBatch(filter, afterId, maxId);
    maxId = batch.maxId;
    appendExportBatch(book, batch);
    count += batch.sticks.length;
    onProgress(count);
    if (batch.nextId === null) break;
    if (batch.nextId <= afterId) throw new Error("Phân trang xuất dữ liệu không tiến triển.");
    afterId = batch.nextId;
    await new Promise((resolve) => setTimeout(resolve, 0));
  } while (true);
  if (!count) return null;
  if (charts) {
    const page = book.addWorksheet("Biểu đồ", {
      views: [{ showGridLines: false }],
      pageSetup: { paperSize: 8, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    page.columns = Array.from({ length: 16 }, () => ({ width: 10 }));
    page.properties.defaultRowHeight = 20;
    page.mergeCells("A1:P1");
    page.getCell("A1").value = "Biểu đồ báo cáo chất lượng";
    page.getCell("A1").font = { name: "Calibri", size: 18, bold: true, color: { argb: "FF123B5D" } };
    page.getRow(1).height = 30;
    page.mergeCells("A2:P3");
    page.getCell("A2").value = charts.label;
    page.getCell("A2").alignment = { vertical: "middle", wrapText: true };
    let row = 5;
    for await (const image of charts.images) {
      const id = book.addImage({ base64: image.png, extension: "png" });
      page.addImage(id, { tl: { col: 0, row: row - 1 }, ext: { width: image.width, height: image.height }, editAs: "oneCell" });
      // Excel row heights use points; image dimensions use CSS pixels (96 dpi).
      row += Math.ceil(image.height / (20 * 96 / 72)) + 2;
      page.getRow(row).addPageBreak();
    }
    page.pageSetup.printArea = `A1:P${row}`;
  }
  return { bytes: new Uint8Array(await book.xlsx.writeBuffer()), count };
}
