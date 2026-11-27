import { useState } from "react";
import { Card, Empty, Pagination, Select, Spin } from "antd";
import dayjs from "dayjs";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ReportSummary, StickFilter } from "../../lib/db";
import { referenceCpk } from "../../lib/reportStats";
import { reportTimeline } from "../../lib/reportTimeline";
import { fmtInt, fmtNum, fmtRate } from "../../lib/format";
import { colors } from "../../theme/tokens";

const empty = (description = "Không có dữ liệu theo bộ lọc") => <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description} />;
const dayLabel = (v: string) => dayjs(v).format("DD/MM");

export function dailyRates(report?: ReportSummary) {
  const daily = report?.daily ?? [];
  return daily.flatMap((d, i) => {
    const row = { ...d, rate: d.total ? d.ok * 100 / d.total : null };
    return i && dayjs(d.day).diff(dayjs(daily[i - 1].day), "day") > 1
      ? [{ day: dayjs(daily[i - 1].day).add(1, "day").format("YYYY-MM-DD"), rate: null, total: 0, ok: 0, ng: 0 }, row]
      : [row];
  });
}

// Export uses fixed dimensions and the same chart JSX/data as the visible page.
export const EXPORT_RATE_PAGE_SIZE = 18;
export function QualityCharts({ report, loading, filter, exportPage, ratePage = 1 }: {
  report?: ReportSummary; loading: boolean; filter: StickFilter; exportPage?: number; ratePage?: number;
}) {
  const exporting = exportPage !== undefined;
  const [chartPage, setChartPage] = useState<number>();
  const timeline = reportTimeline(report, filter, exportPage ?? chartPage);
  const timeFormat = timeline.halfHour ? "DD/MM/YYYY HH:mm" : "DD/MM/YYYY";
  const ng = [...[1, 2, 3, 4].map((pointNo) => ({ station: "BUTT", pointNo })), { station: "TIP", pointNo: 1 }]
    .map((p) => ({ ...p, ng: report?.points.find((r) => r.station === p.station && r.pointNo === p.pointNo)?.ng ?? 0 }));
  const rates = dailyRates(report);
  const visibleRates = exporting ? rates.slice((ratePage - 1) * EXPORT_RATE_PAGE_SIZE, ratePage * EXPORT_RATE_PAGE_SIZE) : rates;
  const low = Math.min(75, ...rates.flatMap((d) => d.rate == null ? [] : [Math.floor(d.rate / 5) * 5]));
  return <section className="report-charts" style={exporting ? { display: "block", width: 1100 } : undefined}>
    <Card className="section-card report-time-card" title={`Số lượng OK / NG theo ${timeline.halfHour ? "30 phút" : "ngày"}`}
      extra={<div className="report-time-legend" aria-label="Chú giải kết quả"><span><i />OK</span><span><i />NG</span></div>}>
      <div className="report-time-window"><small>{timeline.items[0].from.format(timeFormat)} – {timeline.items[timeline.items.length - 1].to.format(timeFormat)}</small>
        <Pagination size="small" simple current={timeline.current} total={timeline.pages} pageSize={1} onChange={setChartPage} /></div>
      <Spin spinning={loading}><div className="report-chart">
        <ResponsiveContainer width={exporting ? 1100 : "100%"} height={exporting ? 360 : "100%"}>
          <BarChart data={timeline.items} maxBarSize={36} margin={{ top: 16, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#edf2f7" />
            <XAxis dataKey="label" interval={0} tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} width={45} />
            <Tooltip labelFormatter={(_, payload) => {
              const row = payload?.[0]?.payload;
              return row ? `${row.from.format(timeFormat)} – ${row.to.format(timeFormat)}` : "";
            }} />
            <Bar dataKey="ok" name="OK" stackId="result" fill={colors.okSolid} isAnimationActive={false} />
            <Bar dataKey="ng" name="NG" stackId="result" fill={colors.ngSolid} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer></div></Spin>
    </Card>
    <Card className="section-card" title="NG theo công đoạn / điểm đo">
      <Spin spinning={loading}>{exporting ? <svg width={1100} height={300} viewBox="0 0 1100 300" role="img" aria-label="NG theo công đoạn / điểm đo">
        {ng.map((p, i) => {
          const ratio = report?.stats.total ? p.ng / report.stats.total : 0;
          const y = 30 + i * 52;
          return <g key={`${p.station}-${p.pointNo}`}>
            <text x={16} y={y + 13} fontSize={15} fill={colors.navy800}>{p.station} P{p.pointNo}</text>
            <rect x={115} y={y} width={760} height={16} rx={6} fill={p.ng ? "#fdebe9" : "#e5f4eb"} />
            <rect x={115} y={y} width={760 * ratio} height={16} rx={6} fill={colors.ngSolid} />
            <text x={900} y={y + 13} fontSize={15} fill={colors.navy800}>{fmtInt(p.ng)} · {p.ng ? fmtRate(p.ng, report?.stats.total ?? 0) : "0%"}</text>
          </g>;
        })}
      </svg> : <div className="report-ng-list">
        {ng.map((p) => <div key={`${p.station}-${p.pointNo}`} className="report-ng-row">
          <span className="report-ng-label">{p.station} P{p.pointNo}</span>
          <div className={`report-ng-track ${p.ng === 0 ? "report-ng-track-zero" : ""}`}><span style={{ width: `${report?.stats.total ? p.ng * 100 / report.stats.total : 0}%` }} /></div>
          <b className="report-ng-value">{fmtInt(p.ng)} · {p.ng ? fmtRate(p.ng, report?.stats.total ?? 0) : "0%"}</b>
        </div>)}
      </div>}</Spin>
    </Card>
    <Card className="section-card" title="Tỷ lệ OK theo ngày">
      <Spin spinning={loading}><div className="report-chart">
        {visibleRates.length ? <ResponsiveContainer width={exporting ? 1100 : "100%"} height={exporting ? 360 : "100%"}>
          <LineChart data={visibleRates} margin={{ top: 30, right: 20, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#edf2f7" />
            <XAxis dataKey="day" tickFormatter={dayLabel} tick={{ fontSize: 12 }} />
            <YAxis domain={[low, 100]} width={48} tickFormatter={(v) => `${v}%`} />
            <Tooltip labelFormatter={(v) => dayjs(String(v)).format("DD/MM/YYYY")}
              formatter={(v) => [`${fmtNum(Number(v))}%`, "Tỷ lệ OK"]} />
            <ReferenceLine y={95} stroke="#94a3b8" strokeDasharray="5 4" label={{ value: "Mục tiêu 95%", position: "insideBottomRight", fontSize: 12 }} />
            <Line dataKey="rate" type="linear" stroke={colors.primary} strokeWidth={2} connectNulls={false} isAnimationActive={false}
              dot={({ cx, cy, value, index }) => value == null ? <g key={index} /> : <circle key={index} cx={cx} cy={cy} r={4} fill={Number(value) < 95 ? colors.ngSolid : colors.okSolid} />}
              activeDot={{ r: 6 }}>
              <LabelList dataKey="rate" position="top" fontSize={11} formatter={(v) => v == null ? "" : `${fmtNum(Number(v), 1)}%`} />
            </Line>
          </LineChart>
        </ResponsiveContainer> : empty()}</div></Spin>
    </Card>
  </section>;
}

export function Histogram({ report, loading, exportPoint }: { report?: ReportSummary; loading: boolean; exportPoint?: number }) {
  const [selectedPoint, setPoint] = useState(0);
  const point = exportPoint ?? selectedPoint;
  const limits = report?.histogramLimits;
  const distribution = report?.bendDistribution?.find((d) => d.pointNo === point);
  const cpk = referenceCpk(distribution?.count ?? 0, distribution?.mean, distribution?.sampleStdDev, limits);
  const bins = limits ? Array.from({ length: 14 }, (_, bucket) => {
    const [lo, hi] = limits;
    const step = (hi - lo) / 12;
    const count = report!.histogram.filter((b) => b.bucket === bucket && (!point || b.pointNo === point)).reduce((sum, b) => sum + b.count, 0);
    return { bucket, count, label: bucket === 0 ? `< ${fmtNum(lo)}` : bucket === 13 ? `> ${fmtNum(hi)}`
      : `${fmtNum(lo + (bucket - 1) * step)}–${fmtNum(lo + bucket * step)}`, outside: bucket === 0 || bucket === 13 };
  }) : [];
  const total = bins.reduce((s, b) => s + b.count, 0);
  const outside = bins.filter((b) => b.outside).reduce((s, b) => s + b.count, 0);
  return <Card className="section-card" title={exportPoint !== undefined && point ? `Phân bố độ cong BUTT · P${point}` : "Phân bố độ cong BUTT (tất cả điểm)"}
    extra={<Select aria-label="Điểm phân bố độ cong BUTT" value={point} onChange={setPoint}
      options={[{ value: 0, label: "Tất cả điểm" }, ...[1, 2, 3, 4].map((n) => ({ value: n, label: `P${n}` }))]} />}>
    <Spin spinning={loading}>
      <div className="report-hist-stats">
        <span>Tổng lượt đo <b>{limits ? fmtInt(total) : "—"}</b></span>
        <span>Trong giới hạn <b>{limits ? fmtInt(total - outside) : "—"}</b></span>
        <span className="report-hist-outside">Vượt giới hạn <b className="report-hist-outside">{limits ? fmtInt(outside) : "—"}</b></span>
        <span>Tỷ lệ trong giới hạn <b>{limits && total ? fmtRate(total - outside, total) : "—"}</b></span>
      </div>
      <div className="report-hist-legend"><span><i />Trong giới hạn</span><span><i />Vượt giới hạn</span></div>
      {limits && total ? <div className="report-hist-scroll"><div className="report-hist-chart">
        <ResponsiveContainer width={exportPoint !== undefined ? 1100 : "100%"} height={exportPoint !== undefined ? 400 : "100%"}><BarChart data={bins} margin={{ top: 24, right: 16, bottom: 40, left: 14 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#edf2f7" />
          <XAxis dataKey="label" interval={0} angle={-30} textAnchor="end" tick={{ fontSize: 11 }} height={65}
            label={{ value: "Khoảng độ cong (mm)", position: "bottom", offset: 20 }} />
          <YAxis allowDecimals={false} width={65} label={{ value: "Số lượt đo", angle: -90, position: "insideLeft" }} />
          <Tooltip formatter={(v) => [fmtInt(Number(v)), "Lượt đo"]} labelFormatter={(v) => `${v} mm`} />
          <Bar dataKey="count" isAnimationActive={false}>{bins.map((b) => <Cell key={b.bucket} fill={b.outside ? colors.limit : colors.primary} />)}<LabelList dataKey="count" position="top" /></Bar>
        </BarChart></ResponsiveContainer>
      </div></div> : <div className="report-chart">{empty(!report ? "Chưa có dữ liệu báo cáo" : !limits ? "Chưa cấu hình giới hạn BUTT hợp lệ" : "Chưa có lượt đo BUTT theo bộ lọc")}</div>}
      <p className="report-note report-distribution-summary">Trung bình: {fmtNum(distribution?.mean)} mm · Độ lệch chuẩn mẫu: {fmtNum(distribution?.sampleStdDev)} mm · Cpk tham chiếu: {fmtNum(cpk)}</p>
      {!!report?.invalidAttempts && <p className="report-note">Bỏ qua {fmtInt(report.invalidAttempts)} lượt BUTT có độ cong không hữu hạn.</p>}
    </Spin>
  </Card>;
}

