import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { useControl, useLive, useLiveRecipe, useProduction, type LiveRecord } from "../../app/LiveProvider";
import Monitor from "./Monitor";
import { useQuery } from "../../lib/useQuery";
import { db } from "../../lib/db";

vi.mock("../../app/LiveProvider", () => ({ useLive: vi.fn(), useLiveRecipe: vi.fn(), useControl: vi.fn(), useProduction: vi.fn() }));
vi.mock("../../lib/useQuery", () => ({ useQuery: vi.fn() }));

const confirmed = { handshake: { pcCmd: 0, plcAck: 0, plcIdle: 1, actSku: "MH1253R", actRev: 7 },
  readAt: new Date("2026-11-26T00:00:00Z") };
const live = () => ({ plcStatus: { state: "connected" as const }, dbStatus: { connected: true, error: null },
  info: null, last: null, savedTick: 0 });
const active = () => ({ confirmed, isLive: true, customer: "TM", recipeError: "", applying: false,
  setApplying: vi.fn(), refreshRecipe: vi.fn(), draftDirty: false, setDraftDirty: vi.fn() });
const production = () => ({ snapshot: { selection: { customer: "MCC" as const, sku: "MH1287S" }, error: null, revision: 1 },
  selecting: false, select: vi.fn() });
const lastRecord = (): LiveRecord => ({ receivedAt: new Date(), save: { state: "saved", id: 1 }, record: {
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
    vi.mocked(useLiveRecipe).mockReturnValue(active());
    vi.mocked(useProduction).mockReturnValue(production());
    vi.mocked(useControl).mockReturnValue({ control: null, lastPoll: null, pollError: null });
  });

  it("shows only the selected SKU in its card and keeps the PLC mismatch warning", () => {
    const html = render();
    expect(html).toContain('<strong class="monitor-sku">MH1287S</strong>');
    expect(html).not.toContain("Khách hàng:");
    expect(html).not.toContain("Người vận hành chọn");
    expect(html).not.toContain("PLC đã áp dụng:");
    expect(html).toContain("SKU không khớp");
    vi.mocked(useLive).mockReturnValue({ ...live(), last: lastRecord() });
    expect(render()).toContain('<strong class="monitor-sku">MH1287S</strong>');
  });

  it("keeps the selected SKU when PLC disconnects", () => {
    vi.mocked(useLive).mockReturnValue({ ...live(), plcStatus: { state: "disconnected", reason: "test" } });
    vi.mocked(useLiveRecipe).mockReturnValue({ ...active(), isLive: false });
    const html = render();
    expect(html).toContain('<strong class="monitor-sku">MH1287S</strong>');
    expect(html).not.toContain("PLC chưa kết nối");
    expect(html).not.toContain("Xác nhận gần nhất");
    expect(html).not.toContain("Trực tiếp từ PLC");
  });

  it("shows PLC Load zero in the latest measurement and chart despite nonzero config", () => {
    const last = lastRecord();
    last.record.butt.load = 0;
    last.record.tip.load = 0;
    const station = { loadKg: 2.5, pushDistMm: null, bendMinMm: null, bendMaxMm: null, positionsMm: [] };
    vi.mocked(useLive).mockReturnValue({ ...live(), last, info: {
      startedAt: "2026-11-26T00:00:00Z", plcAddr: "localhost:502",
      measurement: { butt: station, tip: { ...station, loadKg: 3.25 } },
    } });
    const html = render();
    expect(html).toContain("Lực đè cài đặt BUTT 0,00 kg / TIP");
    expect(html).not.toContain("2,50 kg");
    expect(html).not.toContain("3,25 kg");
    expect(html).toContain("<b>0,00</b>");
    expect(last.record.butt.load).toBe(0);
    expect(last.record.tip.load).toBe(0);
  });

  it("shows zero when no SKU was selected, without borrowing identity from PLC or results", () => {
    vi.mocked(useProduction).mockReturnValue({ ...production(), snapshot: { selection: null, revision: 0, error: null } });
    vi.mocked(useLive).mockReturnValue({ ...live(), last: lastRecord() });
    for (const value of [undefined, { ...confirmed, handshake: { ...confirmed.handshake, actSku: "" } }]) {
      vi.mocked(useLiveRecipe).mockReturnValue({ ...active(), confirmed: value, isLive: false, customer: undefined });
      const html = render();
      expect(html).toContain('<strong class="monitor-sku">0</strong>');
      expect(html).not.toContain("Chưa xác định SKU đang hiển thị");
    }
  });

  it("warns about the captured measurement mismatch even if selection changes later", () => {
    const last = lastRecord();
    last.record.productCode = "MH1253R";
    last.plcProductCode = "PLC-OTHER";
    vi.mocked(useLive).mockReturnValue({ ...live(), last });
    const html = render();
    expect(html).toContain("đã chọn MH1253R, PLC trả PLC-OTHER");
    expect(html).toContain('<strong class="monitor-sku">MH1287S</strong>');
  });

  it("queries 30 saved sticks without an SKU filter while PLC is disconnected and no ActSKU exists", () => {
    const list = vi.spyOn(db, "list").mockResolvedValue({ items: [], total: 0 });
    vi.mocked(useLive).mockReturnValue({ ...live(), plcStatus: { state: "disconnected", reason: "test" } });
    vi.mocked(useLiveRecipe).mockReturnValue({ ...active(), confirmed: undefined, isLive: false });
    vi.mocked(useQuery).mockImplementation((enabled, run) => {
      if (enabled) void run();
      return { data: undefined, loading: false, error: "" };
    });
    try {
      render();
      expect(list).toHaveBeenCalledWith({}, 1, 30);
      expect(list.mock.calls.every(([filter]) => filter.productCode === undefined)).toBe(true);
    } finally { list.mockRestore(); }
  });
});
