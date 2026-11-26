import { Empty, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { StickRecord } from "../lib/plc";
import { CONFIGURED_LOAD_SOURCE, fmtNum } from "../lib/format";
import type { AppInfo } from "../lib/db";
import { ResultTag } from "./Result";
import { decidingAttempt, measuredPoints, stationOf, type StationKey } from "./stick";

interface Row {
  key: string;
  label: string;
  position: number;
  loadKg: number | null | undefined;
  pushDist?: number;
  bend?: number;
  attempts: number;
  result: number;
}

const columns: ColumnsType<Row> = [
  { title: "Trạm / Điểm", dataIndex: "label" },
  { title: <>Vị trí<br />(mm)</>, dataIndex: "position", width: "13%", align: "center", render: (v) => fmtNum(v) },
  { title: <span title={CONFIGURED_LOAD_SOURCE}>Lực đè cài<br />đặt (kg)</span>, dataIndex: "loadKg", width: "13%", align: "center", render: (v) => fmtNum(v) },
  { title: <>Lực đè thực<br />tế (kg)</>, dataIndex: "pushDist", width: "19%", align: "center", render: (v) => fmtNum(v) },
  { title: <>Độ cong<br />(mm)</>, dataIndex: "bend", width: "14%", align: "center", render: (v) => fmtNum(v) },
  { title: <>Số<br />lần đo</>, dataIndex: "attempts", align: "center", width: 54 },
  { title: "Kết quả", dataIndex: "result", width: "13%", align: "center", render: (v) => <ResultTag value={v} /> },
];

/** One row per measured point, with the values of the deciding attempt. */
export default function PointTable({ record, loading, settings }: { record?: StickRecord; loading?: boolean; settings?: AppInfo["measurement"] }) {
  const rows: Row[] = record
    ? (["BUTT", "TIP"] as StationKey[]).flatMap((key) => {
        const s = stationOf(record, key);
        return measuredPoints(s).map((p, i) => {
          const a = decidingAttempt(p);
          return {
            key: `${key}-${i}`,
            label: `${key} · P${i + 1}`,
            position: p.position,
            loadKg: settings?.[key === "BUTT" ? "butt" : "tip"].loadKg,
            pushDist: a?.pushDist,
            bend: a?.bend,
            attempts: p.attemptCount,
            result: p.result,
          };
        });
      })
    : [];
  return (
    <Table<Row>
      className="point-table"
      size="small"
      rowKey="key"
      pagination={false}
      tableLayout="fixed"
      loading={loading}
      dataSource={rows}
      columns={columns}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có dữ liệu điểm đo" /> }}
    />
  );
}
