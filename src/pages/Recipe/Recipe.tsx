import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Empty, InputNumber, Modal, Popconfirm, Select, Space, Spin, Table, Tabs, Tag, message } from "antd";
import { useBlocker } from "react-router";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import PageHeader from "../../components/PageHeader";
import { useLive, useLiveRecipe } from "../../app/LiveProvider";
import { errorText } from "../../lib/db";
import { changeStation, recipeApi, recipeErrors, recipeApplyBlockReason, transferFailure } from "../../lib/recipe";
import type { Recipe as RecipeData, RecipePoint, RecipeStation, RecipeSummary, StationName, RecipeTransferReport } from "../../lib/recipe";
import "./Recipe.css";

const pointFields: { key: keyof RecipePoint; title: string }[] = [
  { key: "posLinear", title: "Vị trí tịnh tiến (mm)" },
  { key: "posPressFixed", title: "Vị trí đè cố định (mm)" },
  { key: "posForce", title: "Vị trí đo lực (mm)" },
  { key: "load", title: "Lực đè (g)" },
  { key: "bend", title: "Độ cong tham chiếu (mm)" },
];
const commonFields: { key: "numPoints" | "maxRot" | "settleTime" | "loadTol" | "bendTol"; title: string; max?: number; min: number; integer?: boolean }[] = [
  { key: "numPoints", title: "Số điểm đo", min: 1, max: 10, integer: true },
  { key: "maxRot", title: "Số lần xoay tối đa", min: 0, max: 3, integer: true },
  { key: "settleTime", title: "Thời gian ổn định (×100 ms)", min: 0, max: 32767, integer: true },
  { key: "loadTol", title: "Dung sai lực đè (g)", min: 0 },
  { key: "bendTol", title: "Dung sai độ cong (mm)", min: 0 },
];

function StationEditor({ name, station, disabled, onChange }: {
  name: StationName; station: RecipeStation; disabled: boolean;
  onChange: (station: RecipeStation) => void;
}) {
  const active = station.enabled === 1;
  const update = (patch: Partial<RecipeStation>) => onChange(changeStation(station, patch));
  return <div className="recipe-station">
    <div className="recipe-settings">
      <label className="filter-field"><span>Sử dụng trạm</span>
        <Select aria-label={`${name.toUpperCase()} · Sử dụng trạm`} value={station.enabled}
          placeholder="Chọn sử dụng hoặc bỏ qua" disabled={disabled} onChange={enabled => update({ enabled })}
          options={[{ value: 1, label: "Sử dụng" }, { value: 0, label: "Bỏ qua trạm" }]} />
      </label>
      {commonFields.map(field => <label className="filter-field" key={field.key}><span>{field.title}</span>
        <InputNumber aria-label={`${name.toUpperCase()} · ${field.title}`} value={station[field.key]}
          placeholder={field.key === "numPoints" ? (name === "butt" ? "4" : "1")
            : field.key === "maxRot" ? "0 – 3" : "≥ 0"}
          disabled={disabled || !active} min={field.min} max={field.max}
          step={field.integer ? 1 : 0.1}
          onChange={value => update({ [field.key]: value })} />
      </label>)}
    </div>
    {station.enabled === 0 && <Alert type="info" showIcon title="Trạm được bỏ qua. Các thông số và điểm đo của trạm này không được sử dụng." />}
    <Table className="recipe-points" size="small" pagination={false} scroll={{ x: 960 }}
      dataSource={station.points.map((point, index) => ({ ...point, index }))} rowKey="index"
      rowClassName={row => !active || row.index >= (station.numPoints ?? 0) ? "recipe-point-unused" : ""}
      columns={[
        { title: "Điểm đo", key: "point", align: "center", width: 90, render: (_, row) => <span title={`Chỉ số ${row.index}`}>P{row.index + 1}<small>chỉ số {row.index}</small></span> },
        ...pointFields.map(field => ({ title: field.title, key: field.key, align: "center" as const,
          render: (_: unknown, row: RecipePoint & { index: number }) => <InputNumber
            aria-label={`${name.toUpperCase()} · P${row.index + 1} · ${field.title}`}
            value={row[field.key]} placeholder="—" step={0.1}
            disabled={disabled || !active || row.index >= (station.numPoints ?? 0)}
            onChange={value => update({ points: station.points.map((point, index) =>
              index === row.index ? { ...point, [field.key]: value } : point) })} />,
        })),
      ]} />
    <p className="recipe-help">Mỗi hàng giữ đủ 5 thông số cùng điểm đo. Giảm số điểm hoặc bỏ qua trạm sẽ xóa các giá trị không sử dụng trong bản đang sửa. Để trống khác với giá trị 0.</p>
  </div>;
}

export default function Recipe() {
  const { dbStatus, plcStatus } = useLive();
  const [messages, messageHolder] = message.useMessage();
  const [modal, modalHolder] = Modal.useModal();
  const [list, setList] = useState<RecipeSummary[]>([]);
  const [customer, setCustomer] = useState<"TM" | "MCC">("TM");
  const [sku, setSku] = useState<string>();
  const [saved, setSaved] = useState<RecipeData>();
  const [draft, setDraft] = useState<RecipeData>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { status: plcRecipe, applying, setApplying, refreshRecipe } = useLiveRecipe();
  const transferInFlight = useRef(false);
  const [transferNotice, setTransferNotice] = useState<RecipeTransferReport>();
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [showValidation, setShowValidation] = useState(false);
  const [reload, setReload] = useState(0);
  const dirty = !!draft && JSON.stringify(draft.stations) !== JSON.stringify(saved?.stations);
  const busy = loading || saving || applying;
  const writing = saving || applying;
  const plcConnected = plcStatus?.state === "connected";
  const applyBlocked = recipeApplyBlockReason(saved, dirty, dbStatus.connected, plcConnected, busy, plcRecipe)
    ?? (loadError ? "Không tải được công thức. Hãy tải lại." : null);
  const errors = draft ? recipeErrors(draft) : [];
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    (dirty || writing) && currentLocation.pathname !== nextLocation.pathname);
  const closeState = useRef({ dirty, writing });
  closeState.current = { dirty, writing };
  const currentDraft = useRef(draft);
  currentDraft.current = draft;

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (closeState.current.dirty || closeState.current.writing) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      getCurrentWindow().onCloseRequested(async event => {
        if (closeState.current.writing) { event.preventDefault(); return; }
        if (closeState.current.dirty) {
          const confirmed = await modal.confirm({ title: "Đóng khi chưa lưu công thức?",
            content: "Các thay đổi chưa lưu sẽ bị mất.", okText: "Bỏ thay đổi và đóng", cancelText: "Tiếp tục sửa" });
          if (!confirmed) event.preventDefault();
        }
      }).then(stop => { if (disposed) stop(); else unlisten = stop; })
        .catch(e => messages.error(`Không thể bật cảnh báo đóng cửa sổ: ${errorText(e)}`));
    }
    return () => { disposed = true; unlisten?.(); window.removeEventListener("beforeunload", beforeUnload); };
  }, [modal, messages]);

  const runTransfer = async (reconcile = false) => {
    if (transferInFlight.current || busy || (!reconcile && (applyBlocked || !saved))) return;
    transferInFlight.current = true;
    setApplying(true); setTransferNotice(undefined);
    try {
      const report = reconcile ? await recipeApi.reconcile() : await recipeApi.apply(saved!.sku, saved!.recipeRev);
      setTransferNotice(report);
      if (report.outcome === "success") messages.success(report.message);
      else if (report.outcome === "failed") messages.error(report.message);
      else messages.warning(report.message);
    } catch (error) {
      const report = transferFailure(error);
      setTransferNotice(report);
      if (report.outcome === "unknown") messages.warning(report.message);
      else messages.error(report.message);
    } finally {
      transferInFlight.current = false; setApplying(false);
    }
  };

  useEffect(() => {
    if (!dbStatus.connected) return;
    let active = true;
    recipeApi.list().then(rows => {
      if (!active) return;
      setList(rows);
    }).catch(e => { if (active) setLoadError(errorText(e)); });
    return () => { active = false; };
  }, [dbStatus.connected, reload]);

  useEffect(() => {
    if (!sku) setSku(list.find(row => row.customer === customer)?.sku);
  }, [list, customer, sku]);

  useEffect(() => {
    // Reconnection must not replace an editor's draft. Explicit reload clears it first.
    if (!sku || !dbStatus.connected || currentDraft.current?.sku === sku) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setLoadError("");
    setSaveError("");
    setShowValidation(false);
    recipeApi.get(sku).then(value => {
      if (!active) return;
      setSaved(value); setDraft(value);
    }).catch(e => { if (active) setLoadError(errorText(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sku, dbStatus.connected, reload]);

  const discardThen = async (action: () => void) => {
    if (busy) return;
    if (dirty && !await modal.confirm({ title: "Công thức có thay đổi chưa lưu",
      content: "Bạn có muốn bỏ các thay đổi để tiếp tục?", okText: "Bỏ thay đổi", cancelText: "Tiếp tục sửa" })) return;
    setDraft(undefined); setSaved(undefined); setSaveError(""); setShowValidation(false);
    action();
  };

  const save = async () => {
    if (!draft || busy) return;
    setShowValidation(true);
    if (errors.length) { messages.error("Vui lòng kiểm tra thông số ở cả hai trạm."); return; }
    setSaving(true); setSaveError("");
    try {
      const result = await recipeApi.save(draft);
      refreshRecipe();
      setDraft(result); setSaved(result); setShowValidation(false);
      setList(rows => rows.map(row => row.sku === result.sku ? result : row));
      messages.success(`Đã lưu công thức ${result.sku} · phiên bản ${result.recipeRev}.`);
    } catch (e) {
      setSaveError(errorText(e)); messages.error("Không lưu được công thức. Dữ liệu đang sửa được giữ lại.");
    } finally { setSaving(false); }
  };

  return <div className="recipe-page">
    {messageHolder}{modalHolder}
    <PageHeader title="5 · Công thức đo" />
    <Card className="section-card" title="Lựa chọn mã hàng">
      <div className="recipe-selection">
        <label className="filter-field"><span>Khách hàng</span>
          <Select aria-label="Khách hàng" value={customer} disabled={busy} options={[{ value: "TM" }, { value: "MCC" }]}
            onChange={value => { if (value !== customer) void discardThen(() => {
              setCustomer(value); setSku(list.find(row => row.customer === value)?.sku);
            }); }} />
        </label>
        <label className="filter-field"><span>Mã hàng (SKU)</span>
          <Select aria-label="Mã hàng (SKU)" value={sku} placeholder="Chọn mã hàng" disabled={busy || !dbStatus.connected}
            options={list.filter(row => row.customer === customer).map(row => ({ value: row.sku, label: row.sku }))}
            onChange={value => { if (value !== sku) void discardThen(() => setSku(value)); }} />
        </label>
        <Button disabled={busy || !dbStatus.connected} onClick={() => void discardThen(() => setReload(v => v + 1))}>Tải lại</Button>
        {saved && <div className="recipe-summary"><strong>{saved.sku}</strong>
          <Space wrap>
            <Tag color={saved.configured ? "green" : "gold"}>{saved.configured ? "Đã thiết lập" : "Chưa thiết lập"}</Tag>
            {dirty && <Tag color="orange">Có thay đổi chưa lưu</Tag>}</Space>
        </div>}
      </div>
    </Card>
    {loadError && <Alert type="error" showIcon title="Không tải được công thức" description={loadError} />}
    {saveError && <Alert type="error" showIcon title="Lưu công thức thất bại" description={saveError} />}
    <Card className="section-card" title="Công thức đang áp dụng trên PLC">
      <div className="recipe-plc-summary">
        <div><span>Mã hàng đang áp dụng</span><strong>{plcConnected ? plcRecipe?.handshake?.actSku || "—" : "—"}</strong></div>
        <div><span>Cho phép đổi công thức</span><strong>{!plcConnected || !plcRecipe?.handshake ? "Chưa xác định"
          : plcRecipe.handshake.plcIdle === 1 ? "Được phép" : "Chưa được phép"}</strong></div>
      </div>
      {plcRecipe?.commissioned && <p className="recipe-help">Xác nhận kỹ thuật: {plcRecipe.confirmationReference}
        {!plcRecipe.blockedReason && <> · Tối đa {plcRecipe.maxWriteWords} WORD/lệnh ghi.</>}</p>}
      {applyBlocked && applyBlocked !== "PLC chưa kết nối." && <Alert className="recipe-plc-condition" type="info" showIcon title={applyBlocked} />}
      {(plcRecipe?.needsReconcile || transferNotice?.outcome === "unknown") && <Popconfirm
        title="Kiểm tra và hoàn tất handshake còn dang dở?" description="Đọc lại PLC; có thể ghi PC_Cmd=0 khi đã có ACK kết thúc và chờ PLC_Ack về 0. Không gửi lại công thức."
        okText="Kiểm tra và hoàn tất" cancelText="Hủy" onConfirm={() => runTransfer(true)}
        disabled={busy || !plcConnected || !plcRecipe?.commissioned || plcRecipe.busy}>
        <Button className="recipe-reconcile" loading={applying} disabled={busy || !plcConnected || !plcRecipe?.commissioned || plcRecipe.busy}>Kiểm tra và hoàn tất handshake PLC</Button>
      </Popconfirm>}
    </Card>
    {transferNotice && <Alert showIcon type={transferNotice.outcome === "success" ? "success" : transferNotice.outcome === "failed" ? "error" : "warning"}
      title={transferNotice.outcome === "success" ? "Nạp công thức hoàn tất" : transferNotice.outcome === "failed" ? "Nạp công thức thất bại" : "Chưa xác định kết quả nạp"}
      description={transferNotice.message} />}
    {showValidation && errors.length > 0 && <Alert type="error" showIcon title="Thông số chưa hợp lệ"
      description={<ul className="recipe-errors">{errors.map((error, i) => <li key={i}>{error}</li>)}</ul>} />}
    <Spin spinning={loading}>
      {draft ? <Card className="section-card">
        <Tabs items={(["butt", "tip"] as const).map(name => ({ key: name, label: `Trạm ${name.toUpperCase()}`,
          children: <StationEditor name={name} station={draft.stations[name]} disabled={busy || !!loadError}
            onChange={station => setDraft(current => current && ({ ...current, stations: { ...current.stations, [name]: station } }))} />,
        }))} />
      </Card> : <Card className="section-card"><Empty description={loading ? "Đang tải công thức…" : "Chọn mã hàng để thiết lập công thức đo"} /></Card>}
    </Spin>
    <div className="recipe-actions">
      <span>Thông số được lưu theo mã hàng và áp dụng chung cho hai trạm.</span>
      <Space><Popconfirm title={`Nạp ${saved?.sku ?? ""} · phiên bản ${saved?.recipeRev ?? ""} xuống PLC?`}
        description="Chỉ nạp bản đã lưu. PLC kiểm tra và áp dụng thông số máy."
        okText="Xác nhận nạp" cancelText="Hủy" disabled={!!applyBlocked} onConfirm={() => runTransfer()}>
        <Button loading={applying} disabled={!!applyBlocked} title={applyBlocked ?? undefined}>Nạp xuống PLC</Button>
      </Popconfirm>
        <Button type="primary" loading={saving} disabled={!draft || !dirty || busy || !!loadError || !dbStatus.connected} onClick={save}>Lưu công thức</Button></Space>
    </div>
    <Modal open={blocker.state === "blocked"} title={writing ? "Đang xử lý công thức" : "Công thức có thay đổi chưa lưu"}
      okText="Bỏ thay đổi và rời trang" cancelText="Ở lại trang" okButtonProps={{ disabled: writing }}
      onOk={() => { if (blocker.state === "blocked" && !writing) blocker.proceed(); }}
      onCancel={() => { if (blocker.state === "blocked") blocker.reset(); }}>
      {writing ? "Vui lòng chờ thao tác lưu/nạp/đối chiếu hoàn tất." : "Các thay đổi chưa lưu sẽ bị mất khi rời trang."}
    </Modal>
  </div>;
}
