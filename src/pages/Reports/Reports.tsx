import { useState } from "react";
import { Alert, Button, Card, DatePicker, Empty, InputNumber, Pagination, Select, Spin, Table, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { FileExcelOutlined, FileTextOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { useLive } from "../../app/LiveProvider";
import PageHeader from "../../components/PageHeader";
import { useOpenStick } from "../../lib/useOpenStick";
import { ResultTag } from "../../components/Result";
import { referenceCpk } from "../../lib/reportStats";
import { reportTimeline } from "../../lib/reportTimeline";
import { db, errorText, type AppInfo, type PointSummary, type ReportSummary, type StickFilter, type StickRow } from "../../lib/db";
import { CONFIGURED_LOAD_SOURCE, fmtDateTime, fmtInt, fmtNum, fmtRate } from "../../lib/format";
import { useQuery } from "../../lib/useQuery";
import { colors } from "../../theme/tokens";
import "./Reports.css";

interface Draft {
  preset: "today" | "week" | "custom";
  from: Dayjs | null; to: Dayjs | null;
  productCode?: string; stickNo?: number | null; result?: number; buttResult?: number; tipResult?: number;
}
const defaults = (): Draft => ({ preset: "week", from: dayjs().subtract(6, "day").startOf("day"), to: dayjs().startOf("day") });
const toFilter = (d: Draft): StickFilter => ({
  from: d.from!.startOf("day").toISOString(), to: d.to!.add(1, "day").startOf("day").toISOString(),
  productCode: d.productCode, stickNo: d.stickNo ?? undefined, result: d.result,
  buttResult: d.buttResult, tipResult: d.tipResult,
});
const empty = (description = "Không có dữ liệu theo bộ lọc") => <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description} />;
const dayLabel = (v: string) => dayjs(v).format("DD/MM");

function QualityCharts({ report, loading, filter }: { report?: ReportSummary; loading: boolean; filter: StickFilter }) {
  const [chartPage, setChartPage] = useState<number>();
  const timeline = reportTimeline(report, filter, chartPage);
  const timeFormat = timeline.halfHour ? "DD/MM/YYYY HH:mm" : "DD/MM/YYYY";
  const daily = report?.daily ?? [];
  const ng = [...[1, 2, 3, 4].map((pointNo) => ({ station: "BUTT", pointNo })), { station: "TIP", pointNo: 1 }]
    .map((p) => ({ ...p, ng: report?.points.find((r) => r.station === p.station && r.pointNo === p.pointNo)?.ng ?? 0 }));
  const rates = daily.flatMap((d, i) => {
    const row = { ...d, rate: d.total ? d.ok * 100 / d.total : null };
    // Break the line across dates with no measurements; never invent a daily rate.
    return i && dayjs(d.day).diff(dayjs(daily[i - 1].day), "day") > 1
      ? [{ day: dayjs(daily[i - 1].day).add(1, "day").format("YYYY-MM-DD"), rate: null, total: 0, ok: 0, ng: 0 }, row]
      : [row];
  });
  const low = Math.min(75, ...rates.flatMap((d) => d.rate == null ? [] : [Math.floor(d.rate / 5) * 5]));
  return <section className="report-charts">
    <Card className="section-card report-time-card" title={`Số lượng OK / NG theo ${timeline.halfHour ? "30 phút" : "ngày"}`}
      extra={<div className="report-time-legend" aria-label="Chú giải kết quả"><span><i />OK</span><span><i />NG</span></div>}>
      <div className="report-time-window"><small>{timeline.items[0].from.format(timeFormat)} – {timeline.items[timeline.items.length - 1].to.format(timeFormat)}</small>
        <Pagination size="small" simple current={timeline.current} total={timeline.pages} pageSize={1} onChange={setChartPage} /></div>
      <Spin spinning={loading}><div className="report-chart">
        <ResponsiveContainer width="100%" height="100%">
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
      <Spin spinning={loading}><div className="report-ng-list">
        {ng.map((p) => <div key={`${p.station}-${p.pointNo}`} className="report-ng-row">
          <span className="report-ng-label">{p.station} P{p.pointNo}</span>
          <div className={`report-ng-track ${p.ng === 0 ? "report-ng-track-zero" : ""}`}><span style={{ width: `${report?.stats.total ? p.ng * 100 / report.stats.total : 0}%` }} /></div>
          <b className="report-ng-value">{fmtInt(p.ng)} · {p.ng ? fmtRate(p.ng, report?.stats.total ?? 0) : "0%"}</b>
        </div>)}
      </div></Spin>
    </Card>
    <Card className="section-card" title="Tỷ lệ OK theo ngày">
      <Spin spinning={loading}><div className="report-chart">
        {rates.length ? <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rates} margin={{ top: 30, right: 20, bottom: 0, left: 0 }}>
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

function Histogram({ report, loading }: { report?: ReportSummary; loading: boolean }) {
  const [point, setPoint] = useState(0);
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
  return <Card className="section-card" title="Phân bố độ cong BUTT (tất cả điểm)"
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
        <ResponsiveContainer width="100%" height="100%"><BarChart data={bins} margin={{ top: 24, right: 16, bottom: 40, left: 14 }}>
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

const pointColumns = (settings?: AppInfo["measurement"]): ColumnsType<PointSummary> => [
  { title: "Trạm / Điểm", render: (_, p) => `${p.station} · P${p.pointNo}`, align: "left" },
  { title: "Vị trí (mm)", render: (_, p) => p.positionMin === p.positionMax ? fmtNum(p.positionMin) : `${fmtNum(p.positionMin)} – ${fmtNum(p.positionMax)}` },
  { title: <span title={CONFIGURED_LOAD_SOURCE}>Lực đè cài đặt (kg)</span>, key: "configuredLoad",
    render: (_, p) => fmtNum(p.station === "BUTT" ? settings?.butt.loadKg : p.station === "TIP" ? settings?.tip.loadKg : undefined) },
  { title: "Lực đè thực tế TB (kg)", dataIndex: "pushDistMm", render: (v) => fmtNum(v) },
  { title: "Độ cong TB (mm)", dataIndex: "bendMm", render: (v) => fmtNum(v) },
  { title: "Số mẫu quyết định", dataIndex: "samples", render: fmtInt },
  { title: "OK", dataIndex: "ok", render: fmtInt },
  { title: "NG", dataIndex: "ng", render: fmtInt },
];

const measurementColumns = (settings?: AppInfo["measurement"]): ColumnsType<StickRow> => [
  { title: "Thời gian đo", dataIndex: "receivedAt", render: fmtDateTime, width: 180 },
  { title: "SKU", dataIndex: "productCode", render: (v) => v || "Chưa gán SKU" },
  { title: "Số gậy", dataIndex: "stickNo", render: (v) => `#${v}`, width: 90 },
  { title: <span title={CONFIGURED_LOAD_SOURCE}>Lực đè cài đặt BUTT (kg)</span>, key: "buttConfiguredLoad", render: () => fmtNum(settings?.butt.loadKg), width: 145 },
  { title: <span title={CONFIGURED_LOAD_SOURCE}>Lực đè cài đặt TIP (kg)</span>, key: "tipConfiguredLoad", render: () => fmtNum(settings?.tip.loadKg), width: 135 },
  { title: "BUTT", dataIndex: "buttResult", render: (v) => <ResultTag value={v} />, width: 90 },
  { title: "TIP", dataIndex: "tipResult", render: (v) => <ResultTag value={v} />, width: 90 },
  { title: "Overall", dataIndex: "overallResult", render: (v) => <ResultTag value={v} />, width: 90 },
];

export default function Reports() {
  const { dbStatus, info } = useLive();
  const [draft, setDraft] = useState<Draft>(defaults);
  const [filter, setFilter] = useState<StickFilter>(() => toFilter(defaults()));
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(1);
  const openStick = useOpenStick();
  const [validation, setValidation] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportCount, setExportCount] = useState(0);
  const [messages, contextHolder] = message.useMessage();
  const report = useQuery(dbStatus.connected, () => db.report(filter), [filter, revision], false);
  const list = useQuery(dbStatus.connected, () => db.list(filter, page, 10), [filter, page, revision], false);
  const skus = useQuery(dbStatus.connected, () => db.skus({}), [revision]);
  const data = report.data;
  const s = data?.stats;
  const maxNg = Math.max(0, ...(data?.points ?? []).map((p) => p.ng));
  const topNg = maxNg ? data!.points.filter((p) => p.ng === maxNg).map((p) => `${p.station} · P${p.pointNo}`).join("\n") : "Không có NG";
  const apply = () => {
    if (!draft.from || !draft.to || draft.from.isAfter(draft.to, "day")) {
      setValidation("Chọn đủ ngày và bảo đảm Từ ngày không sau Đến ngày."); return;
    }
    setValidation(""); setFilter(toFilter(draft)); setPage(1); setRevision((v) => v + 1);
  };
  const reset = () => {
    const d = defaults(); setDraft(d); setFilter(toFilter(d)); setPage(1); setValidation(""); setRevision((v) => v + 1);
  };
  const exportExcel = async () => {
    if (!info) { messages.error("Chưa đọc được cấu hình measurement để xuất Excel."); return; }
    setExporting(true); setExportCount(0);
    try {
      const path = await save({ defaultPath: `New-Ocean-${dayjs().format("YYYYMMDD-HHmmss")}.xlsx`, filters: [{ name: "Excel", extensions: ["xlsx"] }] });
      if (!path) return;
      const { buildReportExcel } = await import("../../lib/reportExcel");
      const result = await buildReportExcel(filter, setExportCount, info.measurement);
      if (!result) { messages.info("Không có dữ liệu phù hợp để xuất Excel."); return; }
      await writeFile(path, result.bytes);
      messages.success(`Đã xuất Excel ${fmtInt(result.count)} gậy.`);
    } catch (e) { messages.error(`Xuất Excel thất bại: ${errorText(e)}`, 8); }
    finally { setExporting(false); }
  };
  const cards = [
    { label: "Tổng số gậy", value: fmtInt(s?.total), note: s && s.total - s.ok - s.ng > 0 ? `${fmtInt(s.total - s.ok - s.ng)} chưa đo / kết quả khác` : "", tone: "blue" },
    { label: "Tổng OK", value: fmtInt(s?.ok), note: s ? `${fmtRate(s.ok, s.total)} tổng số gậy` : "", tone: "green" },
    { label: "Tổng NG", value: fmtInt(s?.ng), note: s ? `${fmtRate(s.ng, s.total)} tổng số gậy` : "", tone: "red" },
    { label: "NG nhiều nhất tại", value: data ? topNg : "—", note: maxNg ? `${fmtInt(maxNg)} NG / điểm` : "Theo kết quả điểm từ PLC", tone: "points" },
    { label: "Gậy phải đo lại (≥ 2 lần)", value: fmtInt(data?.retested), note: "Mỗi gậy được đếm một lần", tone: "blue" },
  ];
  return <div className="reports-page">
    {contextHolder}
    <PageHeader title="3 · Báo cáo" />
    <Card className="section-card report-filters" title="Bộ lọc báo cáo">
      <form onSubmit={(e) => { e.preventDefault(); apply(); }}>
        <div className="report-filter-grid">
          <div className="filter-field report-presets"><span>Khoảng thời gian</span><div role="group" aria-label="Khoảng thời gian">
            {([["today", "Hôm nay"], ["week", "7 ngày"], ["custom", "Tùy chọn"]] as const).map(([preset, label]) =>
              <Button key={preset} type={draft.preset === preset ? "primary" : "default"} aria-pressed={draft.preset === preset}
                onClick={() => setDraft((d) => ({ ...d, preset, ...(preset === "custom" ? {} : { from: dayjs().subtract(preset === "week" ? 6 : 0, "day").startOf("day"), to: dayjs().startOf("day") }) }))}>{label}</Button>)}
          </div></div>
          <label className="filter-field"><span>Từ ngày</span><DatePicker value={draft.from} format="DD/MM/YYYY" placeholder="Chọn ngày" onChange={(from) => setDraft((d) => ({ ...d, from, preset: "custom" }))} /></label>
          <label className="filter-field"><span>Đến ngày</span><DatePicker value={draft.to} format="DD/MM/YYYY" placeholder="Chọn ngày" onChange={(to) => setDraft((d) => ({ ...d, to, preset: "custom" }))} /></label>
          <label className="filter-field"><span>SKU</span><Select showSearch allowClear placeholder="Tất cả SKU" value={draft.productCode} loading={skus.loading}
            options={(skus.data ?? []).map((r) => ({ value: r.productCode, label: r.productCode || "Chưa gán SKU" }))} onChange={(productCode) => setDraft((d) => ({ ...d, productCode }))} /></label>
          <label className="filter-field"><span>Số gậy</span><InputNumber value={draft.stickNo} min={-2147483648} max={2147483647} precision={0} placeholder="Số gậy" onChange={(stickNo) => setDraft((d) => ({ ...d, stickNo }))} /></label>
        </div>
        <div className="report-filter-bottom">
          <div className="report-result-filters">
          <label className="filter-field"><span>Kết quả Overall</span><Select allowClear placeholder="Tất cả" value={draft.result}
            options={[{ value: 1, label: "OK" }, { value: 2, label: "NG" }, { value: 0, label: "Chưa đo" }]} onChange={(result) => setDraft((d) => ({ ...d, result }))} /></label>
          {([['buttResult', 'Kết quả BUTT'], ['tipResult', 'Kết quả TIP']] as const).map(([field, label]) =>
            <label key={field} className="filter-field"><span>{label}</span><Select value={draft[field] ?? "all"}
              options={[{ value: "all", label: "Tất cả" }, { value: 1, label: "OK" }, { value: 2, label: "NG" }]}
              onChange={(value) => setDraft((d) => ({ ...d, [field]: value === "all" ? undefined : Number(value) }))} /></label>)}
          </div>
        <div className="report-actions">
          <Button type="primary" htmlType="submit" icon={<FileTextOutlined />} loading={report.loading} disabled={!dbStatus.connected || exporting}>Tạo báo cáo</Button>
          <Button onClick={reset} disabled={exporting}>Đặt lại</Button>
          <Button className="report-excel" icon={<FileExcelOutlined />} onClick={exportExcel} loading={exporting}
            disabled={!dbStatus.connected || !info || report.loading || !s?.total}>Xuất Excel</Button>
          {exporting && <span role="status">Đang xuất {fmtInt(exportCount)} gậy…</span>}
        </div>
        </div>
      </form>
      {validation && <Alert type="warning" showIcon title={validation} />}
    </Card>
    {(report.error || list.error || skus.error) && <Alert type="error" showIcon title={report.error || list.error || skus.error} />}
    <p className="report-note">Bộ lọc đã áp dụng: {dayjs(filter.from).format("DD/MM/YYYY")} – {dayjs(filter.to).subtract(1, "day").format("DD/MM/YYYY")}
      {filter.productCode !== undefined ? ` · SKU ${filter.productCode || "Chưa gán SKU"}` : " · Tất cả SKU"}
      {filter.stickNo !== undefined ? ` · Gậy #${filter.stickNo}` : ""}
      {filter.result !== undefined ? ` · Overall ${filter.result === 1 ? "OK" : filter.result === 2 ? "NG" : "Chưa đo"}` : ""}
      {filter.buttResult !== undefined ? ` · BUTT ${filter.buttResult === 1 ? "OK" : "NG"}` : ""}
      {filter.tipResult !== undefined ? ` · TIP ${filter.tipResult === 1 ? "OK" : "NG"}` : ""}
      {data ? ` · Cập nhật ${fmtDateTime(data.generatedAt)}` : ""}</p>
    <Spin spinning={report.loading}><section className="report-stats">
      {cards.map((c) => <Card key={c.label} className={`section-card report-stat report-stat-${c.tone}`}><span>{c.label}</span><strong>{c.value}</strong>{c.note && <small>{c.note}</small>}</Card>)}
    </section></Spin>
    <QualityCharts key={`${JSON.stringify(filter)}-${revision}`} report={data} loading={report.loading} filter={filter} />
    <Histogram report={data} loading={report.loading} />
    <Card className="section-card" title="Tổng hợp theo điểm đo">
      <Table<PointSummary> className="report-point-table" size="small" rowKey={(p) => `${p.station}-${p.pointNo}`} columns={pointColumns(info?.measurement)}
        dataSource={data?.points ?? []} loading={report.loading} pagination={false} scroll={{ x: 1100 }} locale={{ emptyText: empty() }} />
    </Card>
    <Card className="section-card" title="Phép đo trong báo cáo" extra={<span className="report-note">{fmtInt(list.data?.total)} gậy</span>}>
      <Table<StickRow> className="report-measurements" rowKey="id" columns={measurementColumns(info?.measurement)} dataSource={list.data?.items ?? []}
        loading={list.loading} scroll={{ x: 1000 }}
        pagination={{ current: page, pageSize: 10, total: list.data?.total ?? 0, onChange: setPage, showSizeChanger: false, hideOnSinglePage: true }}
        onRow={(r) => ({ onClick: () => openStick({ id: r.id }), tabIndex: 0, "aria-label": `Xem chi tiết gậy #${r.stickNo}`,
          onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openStick({ id: r.id }); } } })}
        locale={{ emptyText: empty("Không có gậy phù hợp") }} />
    </Card>
  </div>;
}
