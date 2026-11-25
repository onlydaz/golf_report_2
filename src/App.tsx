import { useEffect, useRef, useState } from "react";
import { Alert, Card, Space, Table, Tag, Typography } from "antd";
import {
  onPlcStatus,
  plc,
  readControlArea,
  type ControlArea,
  type PlcError,
  type PlcStatus,
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

function App() {
  const [status, setStatus] = useState<PlcStatus | null>(null);
  const [data, setData] = useState<ControlArea | null>(null);
  const [error, setError] = useState<string | null>(null);
  const readOnce = useRef(false);

  // Track connection status (initial value + change events).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    onPlcStatus(setStatus).then((u) => (cancelled ? u() : (unlisten = u)));
    plc.status().then(setStatus);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Read the control area a single time, as soon as the PLC is connected.
  useEffect(() => {
    if (status?.state !== "connected" || readOnce.current) return;
    readOnce.current = true;
    readControlArea()
      .then((c) => {
        setData(c);
        setError(null);
      })
      .catch((e: PlcError) => {
        setError(`${e.kind}: ${e.message}`);
        readOnce.current = false; // retry on next connect
      });
  }, [status]);

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

  return (
    <main style={{ padding: 24 }}>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          X212PI – Vùng điều khiển (D25000–D25019)
        </Typography.Title>
        <div>PLC: {statusTag(status)}</div>
        {error && <Alert type="error" showIcon message="Không đọc được vùng điều khiển" description={error} />}
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
      </Space>
    </main>
  );
}

export default App;
