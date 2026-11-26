import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { useControl, useLive, useLiveRecipe, type LiveRecord } from "../../app/LiveProvider";
import Monitor from "./Monitor";

vi.mock("../../app/LiveProvider", () => ({ useLive: vi.fn(), useLiveRecipe: vi.fn(), useControl: vi.fn() }));

const confirmed = { handshake: { pcCmd: 0, plcAck: 0, plcIdle: 1, actSku: "MH1253R", actRev: 7 },
  readAt: new Date("2026-11-26T00:00:00Z") };
const live = () => ({ plcStatus: { state: "connected" as const }, dbStatus: { connected: true, error: null },
  info: null, last: null, savedTick: 0 });
const active = () => ({ confirmed, isLive: true, customer: "TM", recipeError: "", applying: false,
  setApplying: vi.fn(), refreshRecipe: vi.fn() });
const lastRecord = (): LiveRecord => ({ receivedAt: new Date(), save: { state: "saved", id: 1 }, record: {
  version: 1, status: { raw: 0, valid: true, buttChecked: true, tipChecked: true, overallOk: true },
  stickNo: 42, productCode: "PREVIOUS-SKU", overallResult: 1, recordSeq: 42, raw: [],
  butt: { result: 1, pointCount: 0, ngPoint: 0, load: 2500, points: [] },
  tip: { result: 1, pointCount: 0, ngPoint: 0, load: 2500, points: [] },
} });
const render = () => renderToStaticMarkup(<MemoryRouter><Monitor /></MemoryRouter>);

describe("monitor active SKU", () => {
  beforeEach(() => {
    vi.mocked(useLive).mockReturnValue(live());
    vi.mocked(useLiveRecipe).mockReturnValue(active());
    vi.mocked(useControl).mockReturnValue({ control: null, lastPoll: null, pollError: null });
  });

  it("shows PLC SKU/customer before the first result without exposing the revision", () => {
    const html = render();
    expect(html).toContain('<strong class="monitor-sku">MH1253R</strong>');
    expect(html).toContain("Khách hàng: TM");
    expect(html).not.toContain("Phiên bản:");
    expect(html).toContain("Trực tiếp từ PLC");
    vi.mocked(useLive).mockReturnValue({ ...live(), last: lastRecord() });
    expect(render()).toContain('<strong class="monitor-sku">MH1253R</strong>');
  });

  it("marks the last confirmed identity as stale on disconnect", () => {
    vi.mocked(useLive).mockReturnValue({ ...live(), plcStatus: { state: "disconnected", reason: "test" } });
    vi.mocked(useLiveRecipe).mockReturnValue({ ...active(), isLive: false });
    const html = render();
    expect(html).toContain('<strong class="monitor-sku">MH1253R</strong>');
    expect(html).not.toContain("PLC chưa kết nối");
    expect(html).toContain("Giá trị xác nhận gần nhất:");
    expect(html).not.toContain("Trực tiếp từ PLC");
  });

  it("does not substitute a measured SKU for an unread or empty PLC identity", () => {
    vi.mocked(useLive).mockReturnValue({ ...live(), last: lastRecord() });
    for (const value of [undefined, { ...confirmed, handshake: { ...confirmed.handshake, actSku: "" } }]) {
      vi.mocked(useLiveRecipe).mockReturnValue({ ...active(), confirmed: value, isLive: false, customer: undefined });
      const html = render();
      expect(html).toContain('<strong class="monitor-sku">0</strong>');
      expect(html).toContain("Khách hàng: 0");
      expect(html).toContain("Chưa xác định SKU đang hiển thị");
    }
  });
});
