import { type ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import dayjs from "dayjs";
import { QualityCharts, Histogram, dailyRates, EXPORT_RATE_PAGE_SIZE } from "../pages/Reports/ReportCharts";
import type { ReportSummary, StickFilter } from "./db";
import { reportTimeline } from "./reportTimeline";
import { colors } from "../theme/tokens";

export interface ReportChartImage { png: string; width: number; height: number }

// Recharts registers axes/data in effects. Wait for layout and the following paint,
// with a finite deadline if the webview cannot render (e.g. a suspended window).
async function painted() {
  await new Promise<void>((resolve, reject) => {
    let first = 0, second = 0;
    const timer = window.setTimeout(() => {
      cancelAnimationFrame(first); cancelAnimationFrame(second);
      reject(new Error("Không thể dựng biểu đồ để xuất Excel. Hãy giữ cửa sổ ứng dụng đang mở rồi thử lại."));
    }, 10000);
    first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
    });
  });
}

function wrap(context: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && context.measureText(next).width > width) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Rasterize only this chart SVG; titles/legends remain explicit, readable text. */
async function cardPng(card: Element, suffix = ""): Promise<ReportChartImage> {
  const source = card.querySelector("svg.recharts-surface, svg[role='img']");
  if (!source && !card.querySelector(".ant-empty-description")) {
    throw new Error("Biểu đồ chưa dựng xong; không xuất ảnh trống. Vui lòng thử lại.");
  }
  const width = 1140;
  const chartHeight = source ? Number(source.getAttribute("height")) : 160;
  if (!Number.isFinite(chartHeight) || chartHeight <= 0) throw new Error("Biểu đồ trả kích thước không hợp lệ.");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Không thể tạo ảnh PNG cho biểu đồ.");
  const title = `${card.querySelector(".ant-card-head-title")?.textContent ?? "Biểu đồ"}${suffix}`;
  const notes = Array.from(card.querySelectorAll(".report-time-window small, .report-hist-stats, .report-note"))
    .map(element => element.matches(".report-hist-stats")
      ? Array.from(element.children).map(child => child.textContent?.trim()).join(" · ")
      : (element.textContent ?? "").trim()).filter(Boolean);
  const legend = card.querySelector(".report-time-legend, .report-hist-legend");
  context.font = "15px Arial, sans-serif";
  const noteLines = notes.flatMap(note => wrap(context, note, 1100));
  const height = 90 + chartHeight + noteLines.length * 23 + (legend ? 30 : 0);
  // 2x resolution, while Excel uses the original logical dimensions.
  canvas.width = width * 2; canvas.height = height * 2;
  context.scale(2, 2);
  context.fillStyle = "#ffffff"; context.fillRect(0, 0, width, height);
  context.fillStyle = colors.navy900; context.font = "bold 21px Arial, sans-serif";
  context.fillText(title, 20, 32);
  let top = 58;
  context.font = "15px Arial, sans-serif";
  if (legend) {
    let x = 20;
    for (const item of Array.from(legend.children)) {
      const swatch = item.querySelector("i");
      context.fillStyle = swatch ? getComputedStyle(swatch).backgroundColor : colors.primary;
      context.fillRect(x, top - 12, 12, 12);
      context.fillStyle = colors.navy800;
      const text = item.textContent ?? "";
      context.fillText(text, x + 20, top);
      x += 50 + context.measureText(text).width;
    }
    top += 30;
  }
  let url: string | undefined;
  try {
    if (source) {
      const svg = source.cloneNode(true) as SVGElement;
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      // Inline resolved SVG styles so the detached image has no dependency on page CSS/fonts.
      const originals = [source, ...Array.from(source.querySelectorAll("*"))];
      const copies = [svg, ...Array.from(svg.querySelectorAll("*"))];
      originals.forEach((element, index) => {
        const style = getComputedStyle(element);
        const copy = copies[index] as SVGElement;
        for (const property of ["fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "font-size", "font-weight", "text-anchor"]) {
          copy.style.setProperty(property, style.getPropertyValue(property));
        }
        copy.style.fontFamily = "Arial, sans-serif";
      });
      url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml;charset=utf-8" }));
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("Hết thời gian chuyển biểu đồ sang PNG.")), 10000);
        image.onload = () => { clearTimeout(timer); resolve(); };
        image.onerror = () => { clearTimeout(timer); reject(new Error("Không thể chuyển biểu đồ sang PNG.")); };
        image.src = url!;
      });
      context.drawImage(image, 20, top, 1100, chartHeight);
    } else {
      context.fillStyle = colors.navy500;
      const text = card.querySelector(".ant-empty-description")?.textContent ?? "Không có dữ liệu theo bộ lọc";
      context.fillText(text, 30, top + 60);
    }
    top += chartHeight + 24;
    context.fillStyle = colors.navy500;
    context.font = "15px Arial, sans-serif";
    noteLines.forEach(line => { context.fillText(line, 20, top); top += 23; });
    return { png: canvas.toDataURL("image/png"), width, height };
  } finally {
    if (url) URL.revokeObjectURL(url);
    canvas.width = 0; canvas.height = 0;
  }
}

/** Re-render bounded pages off-screen, never capture the application screen. */
export async function* reportChartImages(report: ReportSummary, filter: StickFilter): AsyncGenerator<ReportChartImage> {
  const host = document.createElement("div");
  host.className = "reports-page";
  host.setAttribute("aria-hidden", "true");
  host.setAttribute("inert", "");
  Object.assign(host.style, { position: "fixed", left: "-20000px", top: "0", width: "1140px", pointerEvents: "none" });
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = async (element: ReactElement) => {
    flushSync(() => root.render(element));
    await painted();
    const cards = Array.from(host.querySelectorAll(".ant-card"));
    if (!cards.length) throw new Error("Không dựng được biểu đồ xuất Excel.");
    return cards;
  };
  try {
    const pages = reportTimeline(report, filter, 1).pages;
    for (let page = 1; page <= pages; page++) {
      const cards = await render(<QualityCharts report={report} loading={false} filter={filter} exportPage={page} />);
      yield await cardPng(cards[0], ` · Trang ${page}/${pages}`);
      if (page === 1) yield await cardPng(cards[1]);
    }
    const ratePages = Math.max(1, Math.ceil(dailyRates(report).length / EXPORT_RATE_PAGE_SIZE));
    for (let page = 1; page <= ratePages; page++) {
      const cards = await render(<QualityCharts report={report} loading={false} filter={filter} exportPage={1} ratePage={page} />);
      yield await cardPng(cards[2], ratePages > 1 ? ` · Trang ${page}/${ratePages}` : "");
    }
    for (let point = 0; point <= 4; point++) {
      const cards = await render(<Histogram report={report} loading={false} exportPoint={point} />);
      yield await cardPng(cards[0]);
    }
  } finally {
    try { root.unmount(); } finally { host.remove(); }
  }
}

export function chartFilterLabel(filter: StickFilter) {
  return [
    `${dayjs(filter.from).format("DD/MM/YYYY")} – ${dayjs(filter.to).subtract(1, "day").format("DD/MM/YYYY")}`,
    filter.productCode === undefined ? "Tất cả SKU" : `SKU: ${filter.productCode || "Chưa gán SKU"}`,
    filter.stickNo === undefined ? "" : `Gậy #${filter.stickNo}`,
    ...(["result", "buttResult", "tipResult"] as const).map((key, i) => filter[key] === undefined ? ""
      : `${["Overall", "BUTT", "TIP"][i]}: ${filter[key] === 1 ? "OK" : filter[key] === 2 ? "NG" : "Chưa đo"}`),
  ].filter(Boolean).join(" · ");
}
