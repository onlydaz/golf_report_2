import { useEffect, useState } from "react";
import { Alert, Card, Descriptions, Space, Table, Tag, Typography } from "antd";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  onControlArea,
  onPlcStatus,
  onPollError,
  onRecord,
  plc,
  type ControlArea,
  type PlcStatus,
  type Station,
  type StickRecord,
} from "./lib/plc";

const BASE = 25000;

/** Fields of the control area, in register order. */
const FIELDS: { key: keyof ControlArea; name: string; offset: number; type: string; writer: string }[] = [
  { key: "formatVersion", name: "FormatVersion", offset: 0, type: "INT", writer: "PLC" },
  { key: "recordSize", name: "RecordSize", offset: 1, type: "INT", writer: "PLC" },
  { key: "bufferCount", name: "BufferCount", offset: 2, type: "INT", writer: "PLC" },
  { key: "writeIdx", name: "WriteIdx", offset: 3, type: "INT", writer: "PLC" },
  { key: "totalCount", name: "TotalCount", offset: 4, type: "DINT", writer: "PLC" },
  { key: "lastIdx", name: "LastIdx", offset: 6, type: "INT", writer: "PLC" },
  { key: "heartbeat", name: "Heartbeat", offset: 7, type: "INT", writer: "PLC" },
  { key: "pcReadCount", name: "PC_ReadCount", offset: 8, type: "DINT", writer: "Phần mềm" },
  { key: "pcHeartbeat", name: "PC_Heartbeat", offset: 10, type: "INT", writer: "Phần mềm" },
  { key: "dataReady", name: "DataReady", offset: 11, type: "BOOL", writer: "PLC" },
  { key: "pcReadDone", name: "PC_ReadDone", offset: 12, type: "BOOL", writer: "Phần mềm / PLC" },
];

function statusTag(s: PlcStatus | null) {
  if (!s) return <Tag>?</Tag>;
  if (s.state === "connected") return <Tag color="green">Đã kết nối</Tag>;
  if (s.state === "connecting") return <Tag color="blue">Đang kết nối…</Tag>;
  return <Tag color="red">Mất kết nối: {s.reason}</Tag>;
}

/** 0 none / not measured, 1 OK, 2 NG. */
function resultTag(v: number) {
  if (v === 1) return <Tag color="green">OK</Tag>;
  if (v === 2) return <Tag color="red">NG</Tag>;
  return <Tag>—</Tag>;
}

const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : String(v));

/** Subscribe to several Tauri events, unsubscribing on unmount. */
function useEvents(subs: Promise<UnlistenFn>[]) {
  useEffect(() => {
    let cancelled = false;
    const unlistens: UnlistenFn[] = [];
    subs.forEach((p) => p.then((u) => (cancelled ? u() : unlistens.push(u))));
    return () => {
      cancelled = true;
      unlistens.forEach((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function StationCard({ title, s }: { title: string; s: Station }) {
  const rows = s.points.map((p, i) => ({ key: i, n: i + 1, ...p }));
  return (
    <Card size="small" title={title}>
      <Descriptions size="small" column={4}>
        <Descriptions.Item label="Result">{resultTag(s.result)}</Descriptions.Item>
        <Descriptions.Item label="PointCount">{s.pointCount}</Descriptions.Item>
        <Descriptions.Item label="NGPoint">{s.ngPoint}</Descriptions.Item>
        <Descriptions.Item label="Load (g)">{fmt(s.load)}</Descriptions.Item>
      </Descriptions>
      <Table
        size="small"
        pagination={false}
        dataSource={rows}
        columns={[
          { title: "Điểm", dataIndex: "n" },
          { title: "Result", dataIndex: "result", render: resultTag },
          { title: "Số lần", dataIndex: "attemptCount" },
          { title: "Lần QĐ", dataIndex: "decideAttempt" },
          { title: "Position (mm)", dataIndex: "position", align: "right", render: fmt },
          ...[0, 1, 2, 3].map((k) => ({
            title: `L${k + 1} (${k * 90}°) Push / Bend`,
            key: `a${k}`,
            align: "right" as const,
            render: (_: unknown, p: (typeof rows)[number]) =>
              `${fmt(p.attempts[k].pushDist)} / ${fmt(p.attempts[k].bend)}`,
          })),
        ]}
      />
    </Card>
  );
}

function App() {
  const [status, setStatus] = useState<PlcStatus | null>(null);
  const [data, setData] = useState<ControlArea | null>(null);
  const [lastPoll, setLastPoll] = useState<Date | null>(null);
  const [record, setRecord] = useState<{ r: StickRecord; at: Date } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    plc.status().then(setStatus);
  }, []);

  useEvents([
    onPlcStatus(setStatus),
    onControlArea((c) => {
      setData(c);
      setLastPoll(new Date());
      setError(null);
    }),
    onRecord((r) => setRecord({ r, at: new Date() })),
    onPollError((e) => setError(`${e.kind}: ${e.message}`)),
  ]);

  const rows = FIELDS.map((f) => {
    const value = data ? (data[f.key] as number) : null;
    const words = f.type === "DINT" ? 2 : 1;
    const raw = data?.raw.slice(f.offset, f.offset + words);
    return {
      ...f,
      addr: `D${BASE + f.offset}${words === 2 ? `–D${BASE + f.offset + 1}` : ""}`,
      value,
      raw: raw ? raw.map((w) => `0x${w.toString(16).toUpperCase().padStart(4, "0")}`).join(" ") : "",
    };
  });

  const r = record?.r;

  return (
    <main style={{ padding: 24 }}>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          X212PI – Vùng điều khiển (D25000–D25019)
        </Typography.Title>
        <Space wrap>
          <span>PLC: {statusTag(status)}</span>
          <span>
            DataReady:{" "}
            {data ? <Tag color={data.dataReady === 1 ? "green" : "default"}>{data.dataReady}</Tag> : <Tag>?</Tag>}
          </span>
          <Typography.Text type="secondary">
            Lần đọc cuối: {lastPoll ? lastPoll.toLocaleTimeString() : "—"}
          </Typography.Text>
        </Space>
        {error && <Alert type="error" showIcon message="Lỗi đọc PLC" description={error} />}
        <Card size="small">
          <Table
            size="small"
            pagination={false}
            rowKey="key"
            dataSource={rows}
            loading={!data && !error}
            columns={[
              { title: "Địa chỉ", dataIndex: "addr" },
              { title: "Tên", dataIndex: "name" },
              { title: "Kiểu", dataIndex: "type" },
              { title: "Bên ghi", dataIndex: "writer" },
              { title: "Giá trị", dataIndex: "value", align: "right", render: (v) => (v ?? "—") },
              { title: "Raw (thấp → cao)", dataIndex: "raw", render: (v) => <code>{v}</code> },
            ]}
          />
        </Card>

        <Typography.Title level={4} style={{ margin: 0 }}>
          Bản ghi [0] (D25020–D25259)
        </Typography.Title>
        {!r ? (
          <Typography.Text type="secondary">Chưa có bản ghi – chờ DataReady chuyển 0 → 1.</Typography.Text>
        ) : (
          <>
            <Card size="small" title={`Đọc lúc ${record.at.toLocaleTimeString()}`}>
              <Descriptions size="small" column={3}>
                <Descriptions.Item label="StickNo">{r.stickNo}</Descriptions.Item>
                <Descriptions.Item label="ProductCode">{r.productCode || "—"}</Descriptions.Item>
                <Descriptions.Item label="OverallResult">{resultTag(r.overallResult)}</Descriptions.Item>
                <Descriptions.Item label="RecordSeq">{r.recordSeq}</Descriptions.Item>
                <Descriptions.Item label="Version">{r.version}</Descriptions.Item>
                <Descriptions.Item label="Status">
                  <code>0x{r.status.raw.toString(16).toUpperCase().padStart(4, "0")}</code>{" "}
                  {r.status.valid && <Tag>Valid</Tag>}
                  {r.status.buttChecked && <Tag>Butt checked</Tag>}
                  {r.status.tipChecked && <Tag>Tip checked</Tag>}
                  {r.status.overallOk && <Tag color="green">Overall OK</Tag>}
                </Descriptions.Item>
              </Descriptions>
            </Card>
            <StationCard title="Trạm 2 – BUTT" s={r.butt} />
            <StationCard title="Trạm 3 – TIP" s={r.tip} />
          </>
        )}
      </Space>
    </main>
  );
}

export default App;
