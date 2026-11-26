import { useEffect, useState } from "react";
import { Alert, Button, Card, Input, Tag, message } from "antd";
import dayjs from "dayjs";
import PageHeader from "../../components/PageHeader";
import { useControl, useLive, usePlcDiagnostics } from "../../app/LiveProvider";
import { fmtDateTime, fmtInt, fmtNum } from "../../lib/format";
import "./PlcConnection.css";

function elapsed(from: string | null | undefined, now: number) {
  if (!from) return "—";
  const seconds = Math.max(0, Math.floor((now - Date.parse(from)) / 1000));
  return `${Math.floor(seconds / 3600)} giờ ${Math.floor(seconds % 3600 / 60)} phút ${seconds % 60} giây`;
}

export default function PlcConnection() {
  const { plcStatus } = useLive();
  const { control, lastPoll, pollError } = useControl();
  const { diagnostics: d, diagnosticsError, clearLog } = usePlcDiagnostics();
  const [now, setNow] = useState(Date.now());
  const [clearing, setClearing] = useState(false);
  const [messages, contextHolder] = message.useMessage();
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const status = d?.status ?? plcStatus;
  const connected = status?.state === "connected";
  const fresh = connected && lastPoll && now - lastPoll.getTime() < 3000 && !pollError;
  const c = fresh ? control : null;
  const today = d?.day === dayjs(now).format("YYYY-MM-DD");
  const metrics = [
    { label: "Thời gian kết nối", value: connected ? fmtDateTime(d?.connectedAt) : "—" },
    { label: "Thời gian đã kết nối", value: connected ? elapsed(d?.connectedAt, now) : "—" },
    { label: "Heartbeat PLC", value: fmtInt(c?.heartbeat) },
    { label: "Độ trễ đọc", value: connected && d?.readLatencyMs != null ? `${fmtNum(d.readLatencyMs, 1)} ms` : "—", title: "Thời gian hoàn thành lượt đọc gần nhất qua Actor, gồm thời gian chờ hàng đợi" },
    { label: "DataReady", value: fmtInt(c?.dataReady) },
    { label: "PC_ReadDone", value: fmtInt(c?.pcReadDone) },
    { label: "PC_ReadCount", value: fmtInt(c?.pcReadCount) },
    { label: "Lỗi đọc hôm nay", value: d ? fmtInt(today ? d.readErrorsToday : 0) : "—", title: "Số lượt đọc thất bại hôm nay trong phiên ứng dụng hiện tại" },
    { label: "Mất kết nối hôm nay", value: d ? fmtInt(today ? d.disconnectsToday : 0) : "—", title: "Số lần mất kết nối sau khi đã kết nối thành công, hôm nay trong phiên ứng dụng hiện tại" },
  ];
  const clear = async () => {
    setClearing(true);
    try { await clearLog(); } catch (e) { messages.error(`Không thể xóa nhật ký: ${String(e)}`); }
    finally { setClearing(false); }
  };
  return <div className="plc-connection-page">
    {contextHolder}
    <PageHeader title="4 · Kết nối PLC" />
    {diagnosticsError && <Alert type="error" showIcon title="Không tải được dữ liệu chẩn đoán PLC" description={diagnosticsError} />}
    <div className="plc-connection-columns">
      <Card className="section-card plc-settings" title="Cài đặt kết nối">
        <div className="plc-settings-row">
          <label className="filter-field"><span>Loại PLC</span><Input aria-label="Loại PLC" readOnly value="Delta AS200 Series" /></label>
          <label className="filter-field"><span>Giao thức</span><Input aria-label="Giao thức" readOnly value="Modbus TCP" /></label>
        </div>
        <label className="filter-field"><span>Địa chỉ IP</span><Input aria-label="Địa chỉ IP" readOnly value={d?.ip ?? "—"} /></label>
        <div className="plc-settings-row">
          <label className="filter-field"><span>Cổng kết nối</span><Input aria-label="Cổng kết nối" readOnly value={d?.port ?? "—"} /></label>
          <label className="filter-field"><span>Unit ID</span><Input aria-label="Unit ID" readOnly value={d?.unitId ?? "—"} /></label>
        </div>
      </Card>
      <div className="plc-connection-right">
        <Card className="section-card" title="Trạng thái kết nối" extra={<Tag color={connected ? "green" : status?.state === "disconnected" ? "red" : "gold"}>
          {connected ? "Đã kết nối" : status?.state === "disconnected" ? "Mất kết nối" : status ? "Đang kết nối" : "Chưa có dữ liệu"}
        </Tag>}>
          <dl className="plc-metrics">{metrics.map((m) => <div key={m.label} title={m.title}><dt>{m.label}</dt><dd>{m.value}</dd></div>)}</dl>
        </Card>
        <Card className="section-card" title="Nhật ký kết nối PLC" extra={<Button onClick={clear} loading={clearing} disabled={!d?.logs.length}>Xóa</Button>}>
          <div className="plc-connection-log" role="log" aria-label="Nhật ký kết nối PLC" tabIndex={0}>
            {d?.logs.length ? d.logs.map((log, i) => <div className={`plc-log-line plc-log-${log.tone}`} key={`${log.at}-${i}`}>
              <i aria-hidden="true" /><span><time>{fmtDateTime(log.at)}</time> · {log.message} · {log.address}</span>
            </div>) : <span className="plc-log-empty">Chưa có nhật ký kết nối</span>}
          </div>
        </Card>
      </div>
    </div>
  </div>;
}
