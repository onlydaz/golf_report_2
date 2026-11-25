import { Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { StickRecord } from "../lib/plc";
import { fmtKg, fmtNum } from "../lib/format";
import { ResultTag } from "./Result";
import { decidingAttempt, measuredPoints, stationOf, type StationKey } from "./stick";

interface Row {
  key: string;
  label: string;
  position: number;
  loadG: number;
  pushDist?: number;
  bend?: number;
  attempts: number;
  result: number;
}

const columns: ColumnsType<Row> = [
  { title: "Trạm / Điểm", dataIndex: "label" },
  { title: "Vị trí (mm)", dataIndex: "position", align: "right", render: (v) => fmtNum(v) },
  { title: "Lực đè (kg)", dataIndex: "loadG", align: "right", render: (v) => fmtKg(v) },
  { title: "K/c đẩy (mm)", dataIndex: "pushDist", align: "right", render: (v) => fmtNum(v, 2) },
  { title: "Độ cong (mm)", dataIndex: "bend", align: "right", render: (v) => fmtNum(v) },
  { title: "Số lần", dataIndex: "attempts", align: "center", width: 70 },
  { title: "Kết quả", dataIndex: "result", align: "center", render: (v) => <ResultTag value={v} /> },
];

/** One row per measured point, with the values of the deciding attempt. */
export default function PointTable({ record, loading }: { record?: StickRecord; loading?: boolean }) {
  const rows: Row[] = record
    ? (["BUTT", "TIP"] as StationKey[]).flatMap((key) => {
        const s = stationOf(record, key);
        return measuredPoints(s).map((p, i) => {
          const a = decidingAttempt(p);
          return {
            key: `${key}-${i}`,
            label: `${key} · P${i + 1}`,
            position: p.position,
            loadG: s.load,
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
      loading={loading}
      dataSource={rows}
      columns={columns}
      locale={{ emptyText: "Chưa có dữ liệu điểm đo." }}
    />
  );
}
