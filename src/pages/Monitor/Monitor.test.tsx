import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { useControl, useLive, useProduction, type LiveRecord } from "../../app/LiveProvider";
import Monitor from "./Monitor";
import { useQuery } from "../../lib/useQuery";
import { db } from "../../lib/db";

vi.mock("../../app/LiveProvider", () => ({ useLive: vi.fn(), useControl: vi.fn(), useProduction: vi.fn() }));
vi.mock("../../lib/useQuery", () => ({ useQuery: vi.fn() }));

const live = () => ({ plcStatus: { state: "connected" as const }, dbStatus: { connected: true, error: null },
  info: null, last: null, savedTick: 0 });
const production = () => ({ snapshot: { selection: { customer: "MCC" as const, sku: "MH1287S" }, error: null, revision: 1,
  sessionId: "current-session", sessionStartedAt: "2026-11-26T00:00:00Z" },
  selecting: false, select: vi.fn() });
const lastRecord = (): LiveRecord => ({ productionSession: "current-session", receivedAt: new Date(), save: { state: "saved", id: 1 }, record: {
  version: 1, status: { raw: 0, valid: true, buttChecked: true, tipChecked: true, overallOk: true },
  stickNo: 42, productCode: "PREVIOUS-SKU", overallResult: 1, recordSeq: 42, raw: [],
  butt: { result: 1, pointCount: 0, ngPoint: 0, load: 2500, points: [] },
  tip: { result: 1, pointCount: 0, ngPoint: 0, load: 2500, points: [] },
} });
const render = () => renderToStaticMarkup(<MemoryRouter><Monitor /></MemoryRouter>);

describe("monitor active SKU", () => {
  beforeEach(() => {
    vi.mocked(useQuery).mockReset();
    vi.mocked(useQuery).mockReturnValue({ data: undefined, loading: false, error: "" });
    vi.mocked(useLive).mockReturnValue(live());
    vi.mocked(useProduction).mockReturnValue(production());
    vi.mocked(useControl).mockReturnValue({ control: null, lastPoll: null, pollError: null });
  });

  it("shows only the selected SKU in its card without a PLC mismatch warning", () => {
    const html = render();
    expect(html).toContain('<strong class="monitor-sku">MH1287S</strong>');
    expect(html).not.toContain("Khách hàng:");
    expect(html).not.toContain("Người vận hành chọn");
    expect(html).not.toContain("PLC đã áp dụng:");
    expect(html).not.toContain("SKU không khớp");
    vi.mocked(useLive).mockReturnValue({ ...live(), last: lastRecord() });
    expect(render()).toContain('<strong class="monitor-sku">MH1287S</strong>');
  });

  it("keeps the selected SKU when PLC disconnects", () => {
    vi.mocked(useLive).mockReturnValue({ ...live(), plcStatus: { state: "disconnected", reason: "test" } });
    const html = render();
    expect(html).toContain('<strong class="monitor-sku">MH1287S</strong>');
    expect(html).not.toContain("PLC chưa kết nối");
    expect(html).not.toContain("Xác nhận gần nhất");
    expect(html).not.toContain("Trực tiếp từ PLC");
  });

  it("shows PLC Load zero in the latest measurement and chart", () => {
    const last = lastRecord();
    last.record.productCode = "MH1287S";
    last.record.butt.load = 0;
    last.record.tip.load = 0;
    const station = { bendMinMm: null, bendMaxMm: null };
    vi.mocked(useLive).mockReturnValue({ ...live(), last, info: {
      startedAt: "2026-11-26T00:00:00Z", plcAddr: "localhost:502",
      measurement: { butt: station, tip: station },
    } });
    const html = render();
    expect(html).toContain("Lực đè cài đặt BUTT 0,00 kg / TIP");
    expect(html).not.toContain("2,50 kg");
    expect(html).not.toContain("3,25 kg");
    // Chart cards wait for this SKU's latest stored detail, independently of live data.
    expect(html).toContain("<b>—</b>");
    expect(last.record.butt.load).toBe(0);
    expect(last.record.tip.load).toBe(0);
  });

  it("shows zero when no SKU was selected, without borrowing identity from PLC or results", () => {
    vi.mocked(useProduction).mockReturnValue({ ...production(), snapshot: { ...production().snapshot, selection: null, revision: 0 } });
    vi.mocked(useLive).mockReturnValue({ ...live(), last: lastRecord() });
    const html = render();
    expect(html).toContain('<strong class="monitor-sku">0</strong>');
    expect(html).not.toContain("Chưa xác định SKU đang hiển thị");
  });

  it.each(["PLC-OTHER", ""])("keeps the selected SKU and captured measurement without warning for PLC code %j", plcProductCode => {
    const last = lastRecord();
    last.record.productCode = "MH1253R";
    last.plcProductCode = plcProductCode;
    vi.mocked(useLive).mockReturnValue({ ...live(), last });
    const html = render();
    expect(html).not.toContain("SKU không khớp");
    expect(html).toContain('<strong class="monitor-sku">MH1287S</strong>');
    expect(last.record.productCode).toBe("MH1253R");
    expect(last.plcProductCode).toBe(plcProductCode);
  });

  it("queries all-time SKU chart history and session counters even while PLC is disconnected", () => {
    const list = vi.spyOn(db, "list").mockResolvedValue({ items: [], total: 0 });
    const stats = vi.spyOn(db, "stats").mockResolvedValue({ total: 0, ok: 0, ng: 0,
      buttOk: 0, buttNg: 0, tipOk: 0, tipNg: 0 });
    vi.mocked(useLive).mockReturnValue({ ...live(), plcStatus: { state: "disconnected", reason: "test" } });
    vi.mocked(useQuery).mockImplementation((enabled, run) => {
      if (enabled) void run();
      return { data: undefined, loading: false, error: "" };
    });
    try {
      render();
      expect(list).toHaveBeenCalledWith({ productCode: "MH1287S" }, 1, 30);
      expect(stats).toHaveBeenCalledWith({ productCode: "MH1287S", productionSession: "current-session" });
    } finally { list.mockRestore(); stats.mockRestore(); }
  });

  it.each(["old-session", "current-session"])("does not fill the current result from a previous session/SKU (%s)", session => {
    const last = lastRecord();
    last.productionSession = session;
    if (session === "old-session") last.record.productCode = "MH1287S";
    vi.mocked(useLive).mockReturnValue({ ...live(), last });
    const html = render();
    expect(html).toContain("Chưa có kết quả đo trong phiên hiện tại");
    expect(html).not.toContain("Gậy vừa kiểm tra · #42");
  });
});
