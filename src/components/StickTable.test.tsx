import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StickRow } from "../lib/db";
import StickTable from "./StickTable";

const row: StickRow = { id: 1, receivedAt: "2026-11-26T03:00:00Z", recordSeq: 1, stickNo: 42,
  productCode: "SKU", overallResult: 1, buttResult: 1, tipResult: 1, buttLoadG: 0, tipLoadG: 9000,
  buttBends: [100, null, null, null], tipBends: [100, null, null, null] };
const render = (record = row) => renderToStaticMarkup(<StickTable
  rows={[record]} total={1} page={1} onPage={() => {}} onOpen={() => {}}
  loading={false} emptyText="" />);

describe("saved measurement configured load", () => {
  it("uses archived PLC Load in kg and leaves the original values unchanged", () => {
    const before = JSON.stringify(row);
    const html = render();
    expect(html).not.toContain(">2,50<");
    expect(html).toContain(">0,00<");
    expect(html).toContain(">9,00<");
    expect(html).toContain("Load từ kết quả đo PLC");
    expect(JSON.stringify(row)).toBe(before);
  });

  it("shows missing PLC Load as unknown without substituting zero or a default", () => {
    const html = render({ ...row, buttLoadG: null, tipLoadG: null });
    expect(html).not.toContain(">9,00<");
    expect(html).not.toContain(">0,00<");
    expect(html).not.toContain(">2,50<");
    expect(html).toContain(">—<");
  });
});
