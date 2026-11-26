import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Card, Empty, Select, Spin } from "antd";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { StationSettings, StickRow } from "../lib/db";
import { fmtDateTime, fmtNum } from "../lib/format";
import { colors, pointColors } from "../theme/tokens";
import type { StationKey } from "./stick";
import "./BendChart.css";

const KEYS = ["p1", "p2", "p3", "p4"] as const;
const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

export function bendScale(values: (number | null | undefined)[], limits: (number | null | undefined)[]) {
  const all = [...values, ...limits].filter(finite);
  const lo = all.length ? Math.min(...all) : 0;
  const hi = all.length ? Math.max(...all) : 1;
  const pad = Math.max((hi - lo) * 0.1, 5);
  const domain: [number, number] = [Math.floor(lo - pad), Math.ceil(hi + pad)];
  const ticks = [...new Set([
    ...Array.from({ length: 5 }, (_, i) => domain[0] + (domain[1] - domain[0]) * i / 4),
    ...limits.filter(finite),
  ])].sort((a, b) => a - b);
  return { domain, ticks };
}
type Datum = { id: number; stickNo: number; receivedAt: string } & Record<(typeof KEYS)[number], number | null>;

const exceeds = (v: number | null | undefined, s?: StationSettings) =>
  finite(v) && s != null && ((finite(s.bendMinMm) && v < s.bendMinMm) || (finite(s.bendMaxMm) && v > s.bendMaxMm));

const num = (v: number | null | undefined, unit: string) => (!finite(v) ? "Chưa cấu hình" : `${fmtNum(v)} ${unit}`);

function limitText(s?: StationSettings) {
  if (!s || (s.bendMinMm == null && s.bendMaxMm == null)) return "Chưa cấu hình";
  if (s.bendMinMm == null) return `≤ ${num(s.bendMaxMm, "mm")}`;
  if (s.bendMaxMm == null) return `≥ ${num(s.bendMinMm, "mm")}`;
  return `${s.bendMinMm.toLocaleString("vi-VN")} - ${s.bendMaxMm.toLocaleString("vi-VN")} mm`;
}

function Dot(props: { cx?: number; cy?: number; value?: number | null; color: string; settings?: StationSettings; radius: number }) {
  const { cx, cy, value, color, settings, radius } = props;
  if (cx == null || cy == null || !finite(value)) return <g />;
  return (
    <g>
      {exceeds(value, settings) && <circle cx={cx} cy={cy} r={8} fill="none" stroke={colors.limit} strokeWidth={2} />}
      <circle cx={cx} cy={cy} r={radius} fill={color} />
    </g>
  );
}

/** Bend of the deciding attempt per point, for the given sticks (newest first, as queried). */
export default function BendChart({
  rows,
  settings,
  loading,
  sku,
}: {
  rows: StickRow[];
  settings?: { butt: StationSettings; tip: StationSettings };
  loading: boolean;
  sku?: string;
}) {
  const [station, setStation] = useState<StationKey>("BUTT");
  const raw = settings ? (station === "BUTT" ? settings.butt : settings.tip) : undefined;
  const validOrder = !finite(raw?.bendMinMm) || !finite(raw?.bendMaxMm) || raw.bendMinMm <= raw.bendMaxMm;
  const s = raw ? { ...raw, bendMinMm: validOrder && finite(raw.bendMinMm) ? raw.bendMinMm : null,
    bendMaxMm: validOrder && finite(raw.bendMaxMm) ? raw.bendMaxMm : null } : undefined;
  const actualPoints = rows.reduce((n, r) => Math.max(n, ...r.tipBends.map((v, i) => finite(v) ? i + 1 : 0)), 1);
  const pointCount = station === "BUTT" ? 4 : Math.max(actualPoints, s?.positionsMm.length ?? 1);
  const data: Datum[] = useMemo(
    () =>
      rows.slice(0, 30).reverse().map((r) => {
        const b = (station === "BUTT" ? r.buttBends : r.tipBends).map((v) => finite(v) ? v : null);
        return { id: r.id, stickNo: r.stickNo, receivedAt: r.receivedAt, p1: b[0], p2: b[1], p3: b[2], p4: b[3] };
      }),
    [rows, station],
  );
  const keys = KEYS.slice(0, pointCount);
  const dense = data.length > 15;
  const hasData = !!sku && data.some((d) => keys.some((k) => finite(d[k])));
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastScrolledRecord = useRef<string | undefined>(undefined);
  const newestId = data[data.length - 1]?.id;
  useLayoutEffect(() => {
    if (!hasData || newestId == null || !scrollRef.current) return;
    const recordKey = `${sku}:${newestId}`;
    if (lastScrolledRecord.current === recordKey) return;
    scrollRef.current.scrollLeft = scrollRef.current.scrollWidth - scrollRef.current.clientWidth;
    lastScrolledRecord.current = recordKey;
  }, [newestId, sku, hasData]);
  const { domain, ticks } = bendScale(data.flatMap((d) => keys.map((k) => d[k])), [s?.bendMinMm, s?.bendMaxMm]);

  return (
    <Card
      className="section-card bend-card"
      title="Độ cong thực tế · 30 gậy gần nhất"
      extra={
        <Select
          aria-label="Trạm biểu đồ độ cong"
          value={station}
          onChange={setStation}
          options={[
            { value: "BUTT", label: "Trạm BUTT" },
            { value: "TIP", label: "Trạm TIP" },
          ]}
        />
      }
    >
      <div className="bend-settings">
        <span>Lực đè<b>{num(s?.loadKg, "kg")}</b></span>
        <span>Khoảng cách đẩy<b>{num(s?.pushDistMm, "mm")}</b></span>
        <span>Giới hạn độ cong<b>{limitText(s)}</b></span>
        <span>
          Vị trí điểm đo<b>{s?.positionsMm.length ? `${s.positionsMm.map((v) => v.toLocaleString("vi-VN")).join(" · ")} mm` : "Chưa cấu hình"}</b>
        </span>
      </div>
      <div className="bend-legend">
        {keys.map((k, i) => (
          <span key={k}>
            <i style={{ background: pointColors[i] }} />
            Điểm {i + 1}
          </span>
        ))}
        <span>
          <i className="bend-limit-dot" />
          Vượt giới hạn cài đặt
        </span>
      </div>
      <Spin spinning={loading}>
        {hasData ? (
          <div className="bend-chart-scroll" ref={scrollRef}>
          <div className="bend-chart" style={{ minWidth: Math.max(0, data.length - 1) * 34 + 100 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 16, right: 12, bottom: 8, left: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#edf2f7" />
                <XAxis dataKey="id" interval={0} padding={{ left: 12, right: 12 }}
                  tick={{ fontSize: 12 }} angle={0} textAnchor="middle"
                  height={30} tickMargin={8}
                  tickFormatter={(id) => `#${data.find((d) => d.id === id)?.stickNo ?? ""}`} />
                <YAxis
                  width={64}
                  domain={domain}
                  ticks={ticks}
                  interval={0}
                  allowDataOverflow
                  tickFormatter={(v) => v.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}
                  label={{ value: "Độ cong (mm)", angle: -90, position: "insideLeft", offset: 0,
                    dx: 4, style: { textAnchor: "middle" } }}
                />
                {s?.bendMinMm != null && (
                  <ReferenceLine y={s.bendMinMm} stroke={colors.limit} strokeDasharray="5 4"
                    label={{ value: `Dưới ${s.bendMinMm.toLocaleString("vi-VN")}`, position: "insideBottomRight", fill: "#b42318", fontSize: 12 }} />
                )}
                {s?.bendMaxMm != null && (
                  <ReferenceLine y={s.bendMaxMm} stroke={colors.limit} strokeDasharray="5 4"
                    label={{ value: `Trên ${s.bendMaxMm.toLocaleString("vi-VN")}`, position: "insideTopRight", fill: "#b42318", fontSize: 12 }} />
                )}
                <Tooltip
                  content={({ active, label }) => {
                    const d = data.find((x) => x.id === Number(label));
                    if (!active || !d) return null;
                    return (
                      <div className="bend-tooltip">
                        <strong>{station} · Gậy {d.stickNo}</strong>
                        <div>{fmtDateTime(d.receivedAt)}</div>
                        <div>Giới hạn: {limitText(s)}</div>
                        {keys.map((k, i) => (
                          <div key={k} style={{ color: exceeds(d[k], s) ? colors.limit : pointColors[i] }}>
                            P{i + 1}{finite(s?.positionsMm[i]) ? ` (${s!.positionsMm[i].toLocaleString("vi-VN")} mm)` : ""}: {d[k] == null ? "—" : `${fmtNum(d[k])} mm`}
                            {finite(d[k]) && finite(s?.bendMinMm) && d[k]! < s!.bendMinMm! && ` · Dưới ${fmtNum(s!.bendMinMm! - d[k]!)} mm`}
                            {finite(d[k]) && finite(s?.bendMaxMm) && d[k]! > s!.bendMaxMm! && ` · Vượt ${fmtNum(d[k]! - s!.bendMaxMm!)} mm`}
                          </div>
                        ))}
                      </div>
                    );
                  }}
                />
                {keys.map((k, i) => {
                  const dot = (p: { cx?: number; cy?: number; value?: number | null; index?: number }) => (
                    <Dot key={`${k}-${p.index}`} {...p} color={pointColors[i]} settings={s} radius={dense ? 3 : 4} />
                  );
                  return (
                    <Line key={k} type="linear" dataKey={k} name={`Điểm ${i + 1}`} stroke={pointColors[i]} strokeWidth={2.5}
                      connectNulls={false} dot={dot} activeDot={dot} isAnimationActive={false} />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
          </div>
        ) : (
          <div className="bend-empty">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={sku ? `Chưa có dữ liệu độ cong đã lưu cho trạm ${station}` : "Chưa xác định SKU đang hiển thị"} />
          </div>
        )}
      </Spin>
      <div className="bend-axis">
        <span>Gậy cũ hơn</span>
        <span>Thứ tự gậy →</span>
        <span>Gậy mới nhất</span>
      </div>
    </Card>
  );
}
