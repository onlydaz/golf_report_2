import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Card, Empty, Select, Spin, Tooltip as InfoTooltip } from "antd";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { StickRow } from "../lib/db";
import { fmtDateTime, fmtNum } from "../lib/format";
import { recipeLoadsKg, type Recipe } from "../lib/recipe";
import { pointColors } from "../theme/tokens";
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

export function chartRowsForSku(rows: StickRow[], sku?: string): StickRow[] {
  return sku ? rows.filter(row => row.productCode === sku).slice(0, 30) : [];
}

function Dot(props: { cx?: number; cy?: number; value?: number | null; color: string; radius: number }) {
  const { cx, cy, value, color, radius } = props;
  if (cx == null || cy == null || !finite(value)) return <g />;
  return <circle cx={cx} cy={cy} r={radius} fill={color} />;
}

/** Bend of the deciding attempt per point, for the given sticks (newest first, as queried). */
export default function BendChart({
  rows,
  loading,
  sku,
  recipe,
  recipeNote,
  recipeError,
}: {
  rows: StickRow[];
  loading: boolean;
  sku?: string;
  recipe?: Recipe;
  recipeNote?: string;
  recipeError?: string;
}) {
  const [station, setStation] = useState<StationKey>("BUTT");
  const s = recipe?.stations[station === "BUTT" ? "butt" : "tip"];
  const enabled = s?.enabled === 1;
  const loads = recipeLoadsKg(s);
  const uniformLoad = loads.length > 0 && loads.every(v => v === loads[0]);
  const loadText = !loads.length ? "—" : uniformLoad ? fmtNum(loads[0], 3)
    : `${fmtNum(Math.min(...loads), 3)}–${fmtNum(Math.max(...loads), 3)}`;
  const matchingRows = useMemo(() => chartRowsForSku(rows, sku), [rows, sku]);
  // Historical measurements determine which series exist, never the current recipe's point count.
  const pointCount = station === "BUTT" ? 4 : matchingRows.reduce((n, r) =>
    Math.max(n, ...r.tipBends.map((v, i) => finite(v) ? i + 1 : 0)), 1);
  const data: Datum[] = useMemo(
    () =>
      [...matchingRows].reverse().map((r) => {
        const b = (station === "BUTT" ? r.buttBends : r.tipBends).map((v) => finite(v) ? v : null);
        return { id: r.id, stickNo: r.stickNo, receivedAt: r.receivedAt, p1: b[0], p2: b[1], p3: b[2], p4: b[3] };
      }),
    [matchingRows, station],
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
  const { domain, ticks } = bendScale(data.flatMap((d) => keys.map((k) => d[k])), []);

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
        <span>Số điểm đo<b>{enabled ? s.numPoints : "—"}</b></span>
        <span>Lực đè cài đặt (kg)<InfoTooltip title={!uniformLoad && loads.length
          ? loads.map((v, i) => <div key={i}>P{i + 1}: {fmtNum(v, 3)} kg</div>) : undefined}>
          <b>{loadText}</b>
        </InfoTooltip></span>
        <span>Dung sai độ cong (mm)<b>{enabled ? fmtNum(s.bendTol) : "—"}</b></span>
        <span>Số lần xoay tối đa<b>{enabled ? s.maxRot : "—"}</b></span>
      </div>
      {recipeNote && <div className="bend-note" title={recipeError}>{recipeNote}</div>}
      {s?.enabled === 0 && <div className="bend-note">Trạm {station} không sử dụng trong công thức đang áp dụng.</div>}
      <div className="bend-legend">
        {keys.map((k, i) => (
          <span key={k}>
            <i style={{ background: pointColors[i] }} />
            Điểm {i + 1}
          </span>
        ))}
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
                <Tooltip
                  content={({ active, label }) => {
                    const d = data.find((x) => x.id === Number(label));
                    if (!active || !d) return null;
                    return (
                      <div className="bend-tooltip">
                        <strong>{station} · Gậy {d.stickNo}</strong>
                        <div>{fmtDateTime(d.receivedAt)}</div>
                        {keys.map((k, i) => (
                          <div key={k} style={{ color: pointColors[i] }}>
                            P{i + 1}: {d[k] == null ? "—" : `${fmtNum(d[k])} mm`}
                          </div>
                        ))}
                      </div>
                    );
                  }}
                />
                {keys.map((k, i) => {
                  const dot = (p: { cx?: number; cy?: number; value?: number | null; index?: number }) => (
                    <Dot key={`${k}-${p.index}`} {...p} color={pointColors[i]} radius={dense ? 3 : 4} />
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
