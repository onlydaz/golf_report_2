import { useMemo, useState } from "react";
import { Card, Empty, Select, Spin } from "antd";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { StationSettings, StickRow } from "../lib/db";
import { fmtDateTime, fmtNum } from "../lib/format";
import { colors, pointColors } from "../theme/tokens";
import type { StationKey } from "./stick";
import "./BendChart.css";

const KEYS = ["p1", "p2", "p3", "p4"] as const;
type Datum = { id: number; stickNo: number; receivedAt: string } & Record<(typeof KEYS)[number], number | null>;

const exceeds = (v: number | null | undefined, s?: StationSettings) =>
  v != null && s != null && ((s.bendMinMm != null && v < s.bendMinMm) || (s.bendMaxMm != null && v > s.bendMaxMm));

const num = (v: number | null | undefined, unit: string) => (v == null ? "Chưa cấu hình" : `${fmtNum(v, v % 1 ? 1 : 0)} ${unit}`);

function limitText(s?: StationSettings) {
  if (!s || (s.bendMinMm == null && s.bendMaxMm == null)) return "Chưa cấu hình";
  if (s.bendMinMm == null) return `≤ ${num(s.bendMaxMm, "mm")}`;
  if (s.bendMaxMm == null) return `≥ ${num(s.bendMinMm, "mm")}`;
  return `${fmtNum(s.bendMinMm, 0)} – ${num(s.bendMaxMm, "mm")}`;
}

function Dot(props: { cx?: number; cy?: number; value?: number | null; color: string; settings?: StationSettings }) {
  const { cx, cy, value, color, settings } = props;
  if (cx == null || cy == null || value == null) return <g />;
  return (
    <g>
      {exceeds(value, settings) && <circle cx={cx} cy={cy} r={8} fill="none" stroke={colors.limit} strokeWidth={2} />}
      <circle cx={cx} cy={cy} r={4} fill={color} />
    </g>
  );
}

/** Bend of the deciding attempt per point, for the given sticks (newest first, as queried). */
export default function BendChart({
  rows,
  settings,
  loading,
}: {
  rows: StickRow[];
  settings?: { butt: StationSettings; tip: StationSettings };
  loading: boolean;
}) {
  const [station, setStation] = useState<StationKey>("BUTT");
  const s = settings ? (station === "BUTT" ? settings.butt : settings.tip) : undefined;
  const pointCount = station === "BUTT" ? 4 : Math.max(1, s?.positionsMm.length ?? 1);
  const data: Datum[] = useMemo(
    () =>
      [...rows].reverse().map((r) => {
        const b = station === "BUTT" ? r.buttBends : r.tipBends;
        return { id: r.id, stickNo: r.stickNo, receivedAt: r.receivedAt, p1: b[0], p2: b[1], p3: b[2], p4: b[3] };
      }),
    [rows, station],
  );
  const keys = KEYS.slice(0, pointCount);
  const hasData = data.some((d) => keys.some((k) => d[k] != null));
  const values = data.flatMap((d) => keys.map((k) => d[k])).filter((v): v is number => v != null);
  const lo = Math.min(...values, s?.bendMinMm ?? Infinity);
  const hi = Math.max(...values, s?.bendMaxMm ?? -Infinity);
  const pad = Math.max((hi - lo) * 0.1, 5);
  const domain: [number, number] = [Math.floor(Math.max(0, lo - pad)), Math.ceil(hi + pad)];

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
          Vị trí điểm đo<b>{s?.positionsMm.length ? `${s.positionsMm.map((v) => fmtNum(v, 0)).join(" · ")} mm` : "Chưa cấu hình"}</b>
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
          <div className="bend-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 16, right: 18, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#edf2f7" />
                <XAxis dataKey="id" tickFormatter={(id) => String(data.find((d) => d.id === id)?.stickNo ?? "")} />
                <YAxis
                  width={65}
                  domain={domain}
                  allowDataOverflow
                  tickFormatter={(v) => fmtNum(v, 0)}
                  label={{ value: "Độ cong (mm)", angle: -90, position: "insideLeft" }}
                />
                {s?.bendMinMm != null && (
                  <ReferenceLine y={s.bendMinMm} stroke={colors.limit} strokeDasharray="5 4"
                    label={{ value: `Dưới ${fmtNum(s.bendMinMm, 0)}`, position: "insideBottomRight", fill: "#b42318", fontSize: 12 }} />
                )}
                {s?.bendMaxMm != null && (
                  <ReferenceLine y={s.bendMaxMm} stroke={colors.limit} strokeDasharray="5 4"
                    label={{ value: `Trên ${fmtNum(s.bendMaxMm, 0)}`, position: "insideTopRight", fill: "#b42318", fontSize: 12 }} />
                )}
                <Tooltip
                  content={({ active, label }) => {
                    const d = data.find((x) => x.id === Number(label));
                    if (!active || !d) return null;
                    return (
                      <div className="bend-tooltip">
                        <strong>{station} · Gậy {d.stickNo}</strong>
                        <div>{fmtDateTime(d.receivedAt)}</div>
                        {keys.map((k, i) => (
                          <div key={k} style={{ color: exceeds(d[k], s) ? colors.limit : pointColors[i] }}>
                            P{i + 1}: {d[k] == null ? "—" : `${fmtNum(d[k])} mm`}
                          </div>
                        ))}
                      </div>
                    );
                  }}
                />
                {keys.map((k, i) => {
                  const dot = (p: { cx?: number; cy?: number; value?: number | null; index?: number }) => (
                    <Dot key={`${k}-${p.index}`} {...p} color={pointColors[i]} settings={s} />
                  );
                  return (
                    <Line key={k} type="linear" dataKey={k} name={`Điểm ${i + 1}`} stroke={pointColors[i]} strokeWidth={2.5}
                      connectNulls={false} dot={dot} activeDot={dot} isAnimationActive={false} />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
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
