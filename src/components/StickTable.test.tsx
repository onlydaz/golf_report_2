import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AppInfo, StickRow } from "../lib/db";
import StickTable from "./StickTable";

const row: StickRow = { id: 1, receivedAt: "2026-11-26T03:00:00Z", recordSeq: 1, stickNo: 42,
  productCode: "SKU", overallResult: 1, buttResult: 1, tipResult: 1, buttLoadG: 0, tipLoadG: 9000,
  buttBends: [100, null, null, null], tipBends: [100, null, null, null] };
const render = (settings?: AppInfo["measurement"]) => renderToStaticMarkup(<StickTable
  rows={[row]} total={1} page={1} onPage={() => {}} onOpen={() => {}}
  loading={false} emptyText="" settings={settings} />);

describe("saved measurement configured load", () => {
  it("uses current station config for historical rows and leaves raw PLC Load unchanged", () => {
    const station = { loadKg: 2.5, pushDistMm: null, bendMinMm: null, bendMaxMm: null, positionsMm: [] };
    const before = JSON.stringify(row);
    const html = render({ butt: station, tip: { ...station, loadKg: 3.25 } });
    expect(html).toContain(">2,50<");
    expect(html).toContain(">3,25<");
    expect(html).not.toContain(">0,00<");
    expect(html).not.toContain(">9,00<");
    expect(html).toContain("không phải Load PLC hoặc cấu hình tại thời điểm đo");
    expect(JSON.stringify(row)).toBe(before);
  });

  it("does not fall back to archived PLC Load before config is available", () => {
    const html = render();
    expect(html).not.toContain(">9,00<");
    expect(html).not.toContain(">0,00<");
    expect(html).toContain(">—<");
  });
});
