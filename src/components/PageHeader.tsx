import { useLive } from "../app/LiveProvider";

function Pill({ tone, text, title }: { tone: "connected" | "error" | "unverified"; text: string; title?: string }) {
  return (
    <span className={`page-status-pill page-status-${tone}`} title={title}>
      <i aria-hidden="true" />
      {text}
    </span>
  );
}

/** Page title with PLC / database status pills. */
export default function PageHeader({ title }: { title: string }) {
  const { plcStatus, dbStatus, info } = useLive();
  const ip = info?.plcAddr.replace(/:\d+$/, "") ?? "";
  return (
    <header className="page-heading">
      <h1 className="page-title">{title}</h1>
      <div className="page-status" aria-live="polite">
        {plcStatus?.state === "connected" ? (
          <Pill tone="connected" text={`PLC ${ip} · Đã kết nối`} />
        ) : plcStatus?.state === "disconnected" ? (
          <Pill tone="error" text={`PLC ${ip} · Mất kết nối`} title={plcStatus.reason} />
        ) : (
          <Pill tone="unverified" text={`PLC ${ip} · Đang kết nối…`} />
        )}
        {dbStatus.connected ? (
          <Pill tone="connected" text="CSDL · Đã kết nối" />
        ) : dbStatus.error ? (
          <Pill tone="error" text="CSDL · Mất kết nối" title={dbStatus.error} />
        ) : (
          <Pill tone="unverified" text="CSDL · Đang kết nối…" />
        )}
      </div>
    </header>
  );
}
