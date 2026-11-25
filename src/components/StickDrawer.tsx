import { useEffect, useState } from "react";
import { Alert, Card, Drawer, Spin, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { db, errorText } from "../lib/db";
import type { Point, StickRecord } from "../lib/plc";
import { fmtDateTime, fmtKg, fmtNum } from "../lib/format";
import { ResultTag } from "./Result";
import { attemptCount, measuredPoints, stationOf, type StationKey } from "./stick";
import "./StickDrawer.css";

/** What to show: a saved stick by id, or a record already in memory. */
export type StickSource = { id: number } | { record: StickRecord; receivedAt: Date | string };

const ANGLES = [0, 90, 180, 270];

function StationCard({ record, station }: { record: StickRecord; station: StationKey }) {
  const s = stationOf(record, station);
  const rows = measuredPoints(s).map((p, i) => ({ ...p, key: i, n: i + 1 }));
  const columns: ColumnsType<Point & { key: number; n: number }> = [
    { title: "Điểm", dataIndex: "n", render: (n) => `P${n}` },
    { title: "Vị trí (mm)", dataIndex: "position", render: (v) => fmtNum(v) },
    { title: "KQ", dataIndex: "result", render: (v) => <ResultTag value={v} /> },
    { title: "Số lần", dataIndex: "attemptCount" },
    { title: "Lần QĐ", dataIndex: "decideAttempt" },
    ...ANGLES.map((deg, k) => ({
      title: `L${k + 1} · ${deg}°`,
      key: `a${k}`,
      onCell: (p: Point) => ({ className: p.decideAttempt === k + 1 ? "attempt-decided" : undefined }),
      render: (_: unknown, p: Point) =>
        k < attemptCount(p) ? `${fmtNum(p.attempts[k].pushDist, 2)} / ${fmtNum(p.attempts[k].bend)}` : "—",
    })),
  ];
  return (
    <Card
      size="small"
      className="section-card"
      title={
        <span className="station-head">
          {station === "BUTT" ? "Trạm 2 · BUTT" : "Trạm 3 · TIP"} <ResultTag value={s.result} />
          <small>
            Số điểm {s.pointCount} · NGPoint {s.ngPoint} · Lực đè {fmtKg(s.load)} kg
          </small>
        </span>
      }
    >
      <Table
        size="small"
        rowKey="key"
        pagination={false}
        dataSource={rows}
        columns={columns}
        locale={{ emptyText: "Trạm này không có điểm đo." }}
      />
      <div className="attempt-note">Mỗi ô: khoảng cách đẩy / độ cong (mm).</div>
    </Card>
  );
}

function StickBody({ record, receivedAt }: { record: StickRecord; receivedAt: Date | string }) {
  const st = record.status;
  const hex = `0x${st.raw.toString(16).toUpperCase().padStart(4, "0")}`;
  return (
    <div className="stick-body">
      <dl className="stick-kv">
        <div><dt>StickNo</dt><dd>{record.stickNo}</dd></div>
        <div><dt>SKU</dt><dd>{record.productCode || "—"}</dd></div>
        <div><dt>RecordSeq</dt><dd>{record.recordSeq}</dd></div>
        <div><dt>Thời gian nhận</dt><dd>{fmtDateTime(receivedAt)}</dd></div>
        <div>
          <dt>Status</dt>
          <dd>
            <code>{hex}</code> {st.valid && <Tag>Valid</Tag>}
            {st.buttChecked && <Tag>Butt checked</Tag>}
            {st.tipChecked && <Tag>Tip checked</Tag>}
          </dd>
        </div>
        <div><dt>Overall</dt><dd><ResultTag value={record.overallResult} /></dd></div>
      </dl>
      <StationCard record={record} station="BUTT" />
      <StationCard record={record} station="TIP" />
      <p className="attempt-note">Ô tô xanh là lần đo quyết định kết quả của điểm (DecideAttempt).</p>
    </div>
  );
}

export default function StickDrawer({ source, onClose }: { source: StickSource | null; onClose: () => void }) {
  const id = source && "id" in source ? source.id : null;
  const [loaded, setLoaded] = useState<{ id: number; record: StickRecord; receivedAt: string } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (id == null) return;
    let active = true;
    setError("");
    db.detail(id)
      .then((d) => {
        if (!active) return;
        if (d) setLoaded({ id, record: d.record, receivedAt: d.receivedAt });
        else setError("Không tìm thấy gậy này trong cơ sở dữ liệu.");
      })
      .catch((e) => active && setError(errorText(e)));
    return () => {
      active = false;
    };
  }, [id]);

  const shown =
    source && "record" in source ? source : id != null && loaded?.id === id ? loaded : null;
  return (
    <Drawer
      open={!!source}
      onClose={onClose}
      size={880}
      title={shown ? `Chi tiết gậy · #${shown.record.stickNo}` : "Chi tiết gậy"}
      destroyOnHidden
    >
      {error ? (
        <Alert type="error" showIcon title={error} />
      ) : shown ? (
        <StickBody record={shown.record} receivedAt={shown.receivedAt} />
      ) : (
        <Spin />
      )}
    </Drawer>
  );
}
