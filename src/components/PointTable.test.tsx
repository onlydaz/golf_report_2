import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StickRecord } from "../lib/plc";
import PointTable from "./PointTable";

describe("measurement load units", () => {
  it("converts each station PLC Load from g to kg and preserves zero, actual kg and position zero", () => {
    const station = { result: 1, pointCount: 1, ngPoint: 0, load: 0, points: [{
      result: 1, attemptCount: 2, decideAttempt: 2, position: 0,
      attempts: [{ pushDist: 99, bend: 1 }, { pushDist: 3.756, bend: 2 }],
    }] };
    const record: StickRecord = { version: 1, stickNo: 1, productCode: "MH1253R", overallResult: 1,
      recordSeq: 1, status: { raw: 0, valid: true, buttChecked: true, tipChecked: true, overallOk: true },
      butt: station, tip: { ...station, load: 3250 }, raw: [] };
    const before = JSON.stringify(record);
    const html = renderToStaticMarkup(<PointTable record={record} />);
    expect(html).toContain("Lực đè cài<br/>đặt (kg)");
    expect(html).toContain("Lực đè thực<br/>tế (kg)");
    expect(html).not.toContain("Khoảng cách");
    expect(html).not.toContain(">2,50<");
    expect(html.match(/>3,25</g)).toHaveLength(1);
    expect(html.match(/>0,00</g)).toHaveLength(3);
    expect(html).not.toContain(">80,00<");
    expect(html.match(/>3,76</g)).toHaveLength(2);
    expect(JSON.stringify(record)).toBe(before);
  });
});
