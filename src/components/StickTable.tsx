import { Button, Empty, Table } from "antd";
import { EyeOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import type { AppInfo, StickRow } from "../lib/db";
import { CONFIGURED_LOAD_SOURCE, fmtDateTime, fmtNum } from "../lib/format";
import { ResultTag } from "./Result";

/** Saved results shared by History and Reports; all TIP points are available on the detail page. */
export default function StickTable({ rows, total, page, onPage, onOpen, loading, emptyText, settings, showSku = false, spacious = false }: {
  rows?: StickRow[]; total: number; page: number; onPage: (page: number) => void;
  onOpen: (id: number) => void; loading: boolean; emptyText: string; showSku?: boolean; spacious?: boolean;
  settings?: AppInfo["measurement"];
}) {
  const columnWidth = (width: number) => width + (spacious ? 24 : 0);
  const columns: ColumnsType<StickRow> = [
    { title: "Thời gian đo", dataIndex: "receivedAt", render: fmtDateTime, width: columnWidth(170) },
    { title: "Số gậy", dataIndex: "stickNo", render: (v) => `#${v}`, width: columnWidth(80) },
    ...(showSku ? [{ title: "SKU", dataIndex: "productCode", width: columnWidth(140), render: (v: string) => v || "Chưa gán SKU" }] : []),
    { title: "BUTT", children: [
      ...[0, 1, 2, 3].map((i) => ({ title: `P${i + 1} (mm)`, key: `b${i}`, width: columnWidth(80), render: (_: unknown, r: StickRow) => fmtNum(r.buttBends[i]) })),
      { title: <span title={CONFIGURED_LOAD_SOURCE}>Lực đè cài đặt (kg)</span>, key: "buttConfiguredLoad", render: () => fmtNum(settings?.butt.loadKg), width: columnWidth(100) },
      { title: "Kết quả", dataIndex: "buttResult", render: (v) => <ResultTag value={v} />, width: columnWidth(80) },
    ] },
    { title: "TIP", children: [
      { title: "P1 (mm)", key: "t0", render: (_, r) => fmtNum(r.tipBends[0]), width: columnWidth(80) },
      { title: <span title={CONFIGURED_LOAD_SOURCE}>Lực đè cài đặt (kg)</span>, key: "tipConfiguredLoad", render: () => fmtNum(settings?.tip.loadKg), width: columnWidth(100) },
      { title: "Kết quả", dataIndex: "tipResult", render: (v) => <ResultTag value={v} />, width: columnWidth(80) },
    ] },
    { title: "Overall", dataIndex: "overallResult", render: (v) => <ResultTag value={v} />, width: columnWidth(90) },
    { title: "", key: "open", width: columnWidth(130), render: (_, r) => <Button type="link" icon={<EyeOutlined />} onClick={() => onOpen(r.id)}>Xem chi tiết</Button> },
  ];
  return <Table<StickRow>
    className="saved-stick-table" size="small" rowKey="id" loading={loading}
    dataSource={rows} columns={columns} scroll={{ x: (showSku ? 1370 : 1230) + (spacious ? (showSku ? 14 : 13) * 24 : 0) }}
    pagination={{ current: page, pageSize: 10, total, onChange: onPage, showSizeChanger: false, hideOnSinglePage: true }}
    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} /> }}
  />;
}
