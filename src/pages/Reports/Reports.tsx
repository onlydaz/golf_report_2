import { useRef, useState } from "react";
import { Alert, Button, Card, DatePicker, Empty, InputNumber, Select, Spin, Table, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { FileExcelOutlined, FileTextOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { useLive } from "../../app/LiveProvider";
import PageHeader from "../../components/PageHeader";
import { useOpenStick } from "../../lib/useOpenStick";
import { ResultTag } from "../../components/Result";
import { db, errorText, type PointSummary, type StickFilter, type StickRow } from "../../lib/db";
import { PLC_LOAD_SOURCE, fmtDateTime, fmtInt, fmtKg, fmtNum, fmtRate } from "../../lib/format";
import { useQuery } from "../../lib/useQuery";
import { QualityCharts, Histogram } from "./ReportCharts";
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
const pointColumns: ColumnsType<PointSummary> = [
  { title: "Trạm / Điểm", render: (_, p) => `${p.station} · P${p.pointNo}`, align: "left" },
  { title: "Vị trí (mm)", render: (_, p) => p.positionMin === p.positionMax ? fmtNum(p.positionMin) : `${fmtNum(p.positionMin)} – ${fmtNum(p.positionMax)}` },
  { title: <span title={PLC_LOAD_SOURCE}>Lực đè cài đặt TB (kg)</span>, dataIndex: "loadG", render: fmtKg },
  { title: "Lực đè thực tế TB (kg)", dataIndex: "pushDistMm", render: (v) => fmtNum(v) },
  { title: "Độ cong TB (mm)", dataIndex: "bendMm", render: (v) => fmtNum(v) },
  { title: "Số mẫu quyết định", dataIndex: "samples", render: fmtInt },
  { title: "OK", dataIndex: "ok", render: fmtInt },
  { title: "NG", dataIndex: "ng", render: fmtInt },
];

const measurementColumns: ColumnsType<StickRow> = [
  { title: "Thời gian đo", dataIndex: "receivedAt", render: fmtDateTime, width: 180 },
  { title: "SKU", dataIndex: "productCode", render: (v) => v || "Chưa gán SKU" },
  { title: "Số gậy", dataIndex: "stickNo", render: (v) => `#${v}`, width: 90 },
  { title: <span title={PLC_LOAD_SOURCE}>Lực đè cài đặt BUTT (kg)</span>, dataIndex: "buttLoadG", render: fmtKg, width: 145 },
  { title: <span title={PLC_LOAD_SOURCE}>Lực đè cài đặt TIP (kg)</span>, dataIndex: "tipLoadG", render: fmtKg, width: 135 },
  { title: "BUTT", dataIndex: "buttResult", render: (v) => <ResultTag value={v} />, width: 90 },
  { title: "TIP", dataIndex: "tipResult", render: (v) => <ResultTag value={v} />, width: 90 },
  { title: "Overall", dataIndex: "overallResult", render: (v) => <ResultTag value={v} />, width: 90 },
];

export default function Reports() {
  const { dbStatus } = useLive();
  const [draft, setDraft] = useState<Draft>(defaults);
  const [filter, setFilter] = useState<StickFilter>(() => toFilter(defaults()));
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(1);
  const openStick = useOpenStick();
  const [validation, setValidation] = useState("");
  const [exporting, setExporting] = useState(false);
  const exportInFlight = useRef(false);
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
    if (exportInFlight.current || report.loading || !data) return;
    exportInFlight.current = true;
    // Keep the applied filter and displayed summary fixed throughout file selection/export.
    const exportFilter = { ...filter };
    const exportReport = data;
    setExporting(true); setExportCount(0);
    try {
      const path = await save({ defaultPath: `New-Ocean-${dayjs().format("YYYYMMDD-HHmmss")}.xlsx`, filters: [{ name: "Excel", extensions: ["xlsx"] }] });
      if (!path) return;
      const [{ buildReportExcel }, { reportChartImages, chartFilterLabel }] = await Promise.all([
        import("../../lib/reportExcel"), import("../../lib/reportChartImages"),
      ]);
      const result = await buildReportExcel(exportFilter, setExportCount, {
        label: `${chartFilterLabel(exportFilter)} · Cập nhật ${fmtDateTime(exportReport.generatedAt)}`,
        images: reportChartImages(exportReport, exportFilter),
      });
      if (!result) { messages.info("Không có dữ liệu phù hợp để xuất Excel."); return; }
      await writeFile(path, result.bytes);
      messages.success(`Đã xuất Excel ${fmtInt(result.count)} gậy.`);
    } catch (e) { messages.error(`Xuất Excel thất bại: ${errorText(e)}`, 8); }
    finally { exportInFlight.current = false; setExporting(false); }
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
            disabled={!dbStatus.connected || report.loading || !s?.total}>Xuất Excel</Button>
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
      <Table<PointSummary> className="report-point-table" size="small" rowKey={(p) => `${p.station}-${p.pointNo}`} columns={pointColumns}
        dataSource={data?.points ?? []} loading={report.loading} pagination={false} scroll={{ x: 1100 }} locale={{ emptyText: empty() }} />
    </Card>
    <Card className="section-card" title="Phép đo trong báo cáo" extra={<span className="report-note">{fmtInt(list.data?.total)} gậy</span>}>
      <Table<StickRow> className="report-measurements" rowKey="id" columns={measurementColumns} dataSource={list.data?.items ?? []}
        loading={list.loading} scroll={{ x: 1000 }}
        pagination={{ current: page, pageSize: 10, total: list.data?.total ?? 0, onChange: setPage, showSizeChanger: false, hideOnSinglePage: true }}
        onRow={(r) => ({ onClick: () => openStick({ id: r.id }), tabIndex: 0, "aria-label": `Xem chi tiết gậy #${r.stickNo}`,
          onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openStick({ id: r.id }); } } })}
        locale={{ emptyText: empty("Không có gậy phù hợp") }} />
    </Card>
  </div>;
}
