import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Card, Empty, Select, Spin, Tooltip as InfoTooltip } from "antd";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { StationSettings, StickRow } from "../lib/db";
import { fmtDateTime, fmtKg, fmtNum } from "../lib/format";
import type { StickRecord } from "../lib/plc";
import { colors, pointColors } from "../theme/tokens";
import { decidingAttempt, measuredPoints, stationOf, type StationKey } from "./stick";
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

function Dot(props: { cx?: number; cy?: number; value?: number | null; color: string; radius: number; lower?: number; upper?: number }) {
  const { cx, cy, value, color, radius, lower, upper } = props;
  if (cx == null || cy == null || !finite(value)) return <g />;
  const exceeded = (lower != null && value < lower) || (upper != null && value > upper);
  return <circle cx={cx} cy={cy} r={exceeded ? radius + 1 : radius} fill={exceeded ? colors.limit : color} />;
}

/** Bend of the deciding attempt per point, for the given sticks (newest first, as queried). */
export default function BendChart({
  rows,
  loading,
  latestRecord,
  settings,
}: {
  rows: StickRow[];
  loading: boolean;
  latestRecord?: StickRecord;
  settings?: { butt: StationSettings; tip: StationSettings };
}) {
  const [station, setStation] = useState<StationKey>("BUTT");
  const s = latestRecord ? stationOf(latestRecord, station) : undefined;
  const reference = settings?.[station === "BUTT" ? "butt" : "tip"];
  const validOrder = !finite(reference?.bendMinMm) || !finite(reference?.bendMaxMm)
    || reference.bendMinMm <= reference.bendMaxMm;
  const lower = validOrder && finite(reference?.bendMinMm) ? reference.bendMinMm : undefined;
  const upper = validOrder && finite(reference?.bendMaxMm) ? reference.bendMaxMm : undefined;
  const referenceNum = (v: number) => v.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
  const limitText = lower != null && upper != null ? `${referenceNum(lower)}–${referenceNum(upper)}`
    : lower != null ? `≥ ${referenceNum(lower)}` : upper != null ? `≤ ${referenceNum(upper)}` : "Chưa cấu hình";
  // PushDist is already kg. Keep each point's deciding attempt; do not use config pushDistMm.
  const loads = (s ? measuredPoints(s) : []).map((p, i) => ({ point: i + 1, value: decidingAttempt(p)?.pushDist }))
    .filter((p): p is { point: number; value: number } => finite(p.value));
  const uniformLoad = loads.length > 0 && loads.every(p => p.value === loads[0].value);
  const loadText = !loads.length ? "—" : uniformLoad ? fmtNum(loads[0].value)
    : `${fmtNum(Math.min(...loads.map(p => p.value)))}–${fmtNum(Math.max(...loads.map(p => p.value)))}`;
  const recentRows = useMemo(() => rows.slice(0, 30), [rows]);
  const pointCount = station === "BUTT" ? 4 : recentRows.reduce((n, r) =>
    Math.max(n, ...r.tipBends.map((v, i) => finite(v) ? i + 1 : 0)), 1);
  const data: Datum[] = useMemo(
    () =>
      [...recentRows].reverse().map((r) => {
        const b = (station === "BUTT" ? r.buttBends : r.tipBends).map((v) => finite(v) ? v : null);
        return { id: r.id, stickNo: r.stickNo, receivedAt: r.receivedAt, p1: b[0], p2: b[1], p3: b[2], p4: b[3] };
      }),
    [recentRows, station],
  );
  const keys = KEYS.slice(0, pointCount);
  const dense = data.length > 15;
  const hasData = data.some((d) => keys.some((k) => finite(d[k])));
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastScrolledRecord = useRef<number | undefined>(undefined);
  const newestId = data[data.length - 1]?.id;
  useLayoutEffect(() => {
    if (!hasData || newestId == null || !scrollRef.current) return;
    if (lastScrolledRecord.current === newestId) return;
    scrollRef.current.scrollLeft = scrollRef.current.scrollWidth - scrollRef.current.clientWidth;
    lastScrolledRecord.current = newestId;
  }, [newestId, hasData]);
  const { domain, ticks } = bendScale(data.flatMap((d) => keys.map((k) => d[k])), [lower, upper]);

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
        <span aria-label="Lực đè cài đặt (kg)"><span className="bend-setting-title">Lực đè cài đặt</span>
          <span className="bend-setting-unit">(kg)</span><b>{fmtKg(s?.load)}</b></span>
        <span aria-label="Lực đè thực tế (kg)"><span className="bend-setting-title">Lực đè thực tế</span>
          <span className="bend-setting-unit">(kg)</span><InfoTooltip title={!uniformLoad && loads.length
          ? loads.map(p => <div key={p.point}>P{p.point}: {fmtNum(p.value)} kg</div>) : undefined}>
          <b>{loadText}</b>
        </InfoTooltip></span>
        <span aria-label="Giới hạn độ cong (mm)" title="Giới hạn tham chiếu từ config.toml"><span className="bend-setting-title">Giới hạn độ cong</span>
          <span className="bend-setting-unit">(mm)</span><b>{limitText}</b></span>
        <span aria-label="Vị trí điểm đo (mm)" title="Vị trí tham chiếu từ config.toml"><span className="bend-setting-title">Vị trí điểm đo</span>
          <span className="bend-setting-unit">(mm)</span><b>{reference?.positionsMm.length
          ? reference.positionsMm.map(v => finite(v) ? referenceNum(v) : "—").join(" · ") : "Chưa cấu hình"}</b></span>
      </div>
      <div className="bend-legend">
        {keys.map((k, i) => (
          <span key={k}>
            <i style={{ background: pointColors[i] }} />
            Điểm {i + 1}
          </span>
        ))}
        <span title="Cảnh báo hiển thị theo giới hạn config.toml; không thay đổi kết quả OK/NG của PLC.">
          <i className="bend-exceeded-dot" />Vượt giới hạn (NG)
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
                {lower != null && <ReferenceLine y={lower} stroke={colors.limit} strokeDasharray="5 4"
                  label={{ value: `Giới hạn ${referenceNum(lower)}`, position: "insideBottomRight", fill: colors.limit, fontSize: 12 }} />}
                {upper != null && <ReferenceLine y={upper} stroke={colors.limit} strokeDasharray="5 4"
                  label={{ value: `Giới hạn ${referenceNum(upper)}`, position: "insideTopRight", fill: colors.limit, fontSize: 12 }} />}
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
                    <Dot key={`${k}-${p.index}`} {...p} color={pointColors[i]} radius={dense ? 3 : 4} lower={lower} upper={upper} />
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
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`Chưa có dữ liệu độ cong đã lưu cho trạm ${station}`} />
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
