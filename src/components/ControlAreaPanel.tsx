import { Collapse, Table } from "antd";
import { useControl } from "../app/LiveProvider";
import type { ControlArea } from "../lib/plc";

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

function ControlTable() {
  const { control } = useControl();
  const rows = FIELDS.map((f) => {
    const words = f.type === "DINT" ? 2 : 1;
    const raw = control?.raw.slice(f.offset, f.offset + words);
    return {
      ...f,
      addr: `D${BASE + f.offset}${words === 2 ? `–D${BASE + f.offset + 1}` : ""}`,
      value: control ? (control[f.key] as number) : null,
      raw: raw ? raw.map((w) => `0x${w.toString(16).toUpperCase().padStart(4, "0")}`).join(" ") : "",
    };
  });
  return (
    <Table
      size="small"
      pagination={false}
      rowKey="key"
      dataSource={rows}
      columns={[
        { title: "Địa chỉ", dataIndex: "addr" },
        { title: "Tên", dataIndex: "name" },
        { title: "Kiểu", dataIndex: "type" },
        { title: "Bên ghi", dataIndex: "writer" },
        { title: "Giá trị", dataIndex: "value", align: "right", render: (v) => v ?? "—" },
        { title: "Raw (thấp → cao)", dataIndex: "raw", render: (v) => <code>{v}</code> },
      ]}
    />
  );
}

/** Technical view of D25000–D25019, collapsed by default. */
export default function ControlAreaPanel() {
  return (
    <Collapse
      className="section-card control-panel"
      items={[
        {
          key: "control",
          label: "Vùng điều khiển PLC (kỹ thuật) · D25000–D25019",
          children: <ControlTable />,
        },
      ]}
    />
  );
}
