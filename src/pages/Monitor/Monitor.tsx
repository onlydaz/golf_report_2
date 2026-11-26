import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Empty, Spin, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useNavigate } from "react-router";
import { useControl, useLive, useLiveRecipe, type SaveState } from "../../app/LiveProvider";
import BendChart from "../../components/BendChart";
import PageHeader from "../../components/PageHeader";
import PointTable from "../../components/PointTable";
import { ResultTag, ResultTiles } from "../../components/Result";
import { useOpenStick } from "../../lib/useOpenStick";
import { useQuery } from "../../lib/useQuery";
import { db, type StickPage, type StickRow, type StickStats } from "../../lib/db";
import { type StickRecord } from "../../lib/plc";
import { fmtDateTime, fmtInt, fmtKg, fmtNum, fmtRate, fmtTime } from "../../lib/format";
import "./Monitor.css";

const RECENT_PAGE_SIZE = 6;
const CHART_SIZE = 30;
/** No control-area read for this long means polling has stalled. */
const STALE_MS = 3000;

function count(v: number | undefined, loading: boolean) {
  return v === undefined && loading ? <Spin size="small" /> : fmtInt(v ?? 0);
}

function SummaryCards({ stats, loading, startedAt }: { stats?: StickStats; loading: boolean; startedAt?: string }) {
  const total = stats?.total ?? 0;
  return (
    <>
      <Card className="section-card monitor-count monitor-count-ok">
        <div className="kicker">OK</div>
        <strong>{count(stats?.ok, loading)}</strong>
        <small>{fmtRate(stats?.ok ?? 0, total)} tổng số gậy</small>
      </Card>
      <Card className="section-card monitor-count monitor-count-ng">
        <div className="kicker">NG</div>
        <strong>{count(stats?.ng, loading)}</strong>
        <small>{fmtRate(stats?.ng ?? 0, total)} tổng số gậy</small>
      </Card>
      <Card className="section-card monitor-count">
        <div className="kicker">Tổng số gậy</div>
        <strong>{count(stats?.total, loading)}</strong>
        <small>Từ khi mở app {startedAt ? fmtTime(startedAt).slice(0, 5) : ""}</small>
      </Card>
      <Card className="section-card">
        <div className="kicker">Theo trạm</div>
        <div className="monitor-stations">
          {(
            [
              ["BUTT", stats?.buttOk, stats?.buttNg],
              ["TIP", stats?.tipOk, stats?.tipNg],
            ] as const
          ).map(([name, ok, ng]) => (
            <div key={name}>
              <b>{name}</b>
              <div className="monitor-station-counts">
                <span>OK<strong>{count(ok, loading)}</strong></span>
                <span>NG<strong>{count(ng, loading)}</strong></span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

function PlcStateCard() {
  const { plcStatus } = useLive();
  const { lastPoll, pollError } = useControl();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const stale = !lastPoll || now - lastPoll.getTime() > STALE_MS;
  const [label, tone] =
    plcStatus?.state === "disconnected"
      ? ["Mất kết nối PLC", "error"]
      : plcStatus?.state !== "connected"
        ? ["Đang kết nối PLC…", "muted"]
        : pollError
          ? ["Lỗi đọc PLC", "error"]
          : stale
            ? ["Chưa đọc được PLC", "muted"]
            : ["Đang thu dữ liệu", "running"];
  return (
    <Card className="section-card">
      <div className="kicker">Trạng thái máy</div>
      <strong className={`monitor-machine monitor-machine-${tone}`}>{label}</strong>
    </Card>
  );
}

function SaveTag({ save }: { save: SaveState }) {
  if (save.state === "saved") return null;
  if (save.state === "error") return <Tag color="red" title={save.message}>Lưu thất bại</Tag>;
  return <Tag color="orange">Đang lưu…</Tag>;
}

/** Last stick: the live record of this run, else the newest saved one. */
function CurrentStick({
  current,
  loading,
  onOpen,
}: {
  current?: { record: StickRecord; receivedAt: Date | string; save: SaveState };
  loading: boolean;
  onOpen: () => void;
}) {
  const r = current?.record;
  return (
    <Card className="section-card monitor-current">
      <div className="monitor-current-heading">
        <h2>Gậy vừa kiểm tra · {r ? `#${r.stickNo}` : "Chưa có dữ liệu"}</h2>
        {r && (
          <span>
            {fmtTime(current.receivedAt)} · RecordSeq {r.recordSeq} · Lực đè BUTT {fmtKg(r.butt.load)} kg / TIP{" "}
            {fmtKg(r.tip.load)} kg
          </span>
        )}
      </div>
      <ResultTiles butt={r?.butt.result} tip={r?.tip.result} overall={r?.overallResult} />
      {current && current.save.state !== "saved" && (
        <div className="monitor-save">
          Lưu CSDL <SaveTag save={current.save} />
          {current.save.state === "error" && <span className="monitor-save-error">{current.save.message}</span>}
        </div>
      )}
      <PointTable record={r} loading={loading && !r} />
      {r && (
        <Button className="monitor-open" onClick={onOpen}>
          Xem các lần đo từng điểm
        </Button>
      )}
    </Card>
  );
}

function RecentTable({
  page,
  data,
  loading,
  onPage,
  onRefresh,
  onOpen,
}: {
  page: number;
  data?: StickPage;
  loading: boolean;
  onPage: (p: number) => void;
  onRefresh: () => void;
  onOpen: (id: number) => void;
}) {
  const navigate = useNavigate();
  const columns = useMemo<ColumnsType<StickRow>>(
    () => [
      { title: "Thời gian", dataIndex: "receivedAt", render: fmtTime, width: 120 },
      { title: "Số gậy", dataIndex: "stickNo", render: (v) => `#${v}`, width: 90 },
      { title: "SKU", dataIndex: "productCode", render: (v) => v || "—", width: 150 },
      { title: "BUTT P1 / P2 / P3 / P4 (mm)", render: (_, r) => r.buttBends.map((v) => fmtNum(v)).join(" / "), width: 280 },
      { title: "TIP (mm)", render: (_, r) => fmtNum(r.tipBends[0]), width: 100 },
      { title: "BUTT", dataIndex: "buttResult", render: (v) => <ResultTag value={v} />, width: 100 },
      { title: "TIP", dataIndex: "tipResult", render: (v) => <ResultTag value={v} />, width: 100 },
      { title: "Overall", dataIndex: "overallResult", render: (v) => <ResultTag value={v} />, width: 100 },
    ],
    [],
  );
  return (
    <Card
      className="section-card"
      title="Các gậy gần nhất"
      extra={
        <>
          <Button type="text" size="small" loading={loading} onClick={onRefresh}>Làm mới</Button>
          <Button type="link" size="small" onClick={() => navigate("/history")}>Xem toàn bộ lịch sử →</Button>
        </>
      }
    >
      <Table<StickRow>
        className="monitor-recent"
        size="small"
        rowKey="id"
        loading={loading}
        dataSource={data?.items}
        columns={columns}
        scroll={{ x: 1040 }}
        pagination={{ current: page, pageSize: RECENT_PAGE_SIZE, total: data?.total ?? 0, onChange: onPage, hideOnSinglePage: true, showSizeChanger: false }}
        onRow={(r) => ({ onClick: () => onOpen(r.id) })}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có gậy nào được lưu" /> }}
      />
    </Card>
  );
}

export default function Monitor() {
  const { dbStatus, info, last, savedTick } = useLive();
  const active = useLiveRecipe();
  const connected = dbStatus.connected;
  const [recentPage, setRecentPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const openStick = useOpenStick();

  const stats = useQuery(connected && !!info, () => db.stats({ from: info!.startedAt }), [info, savedTick, refresh]);
  const recent = useQuery(connected, () => db.list({}, recentPage, RECENT_PAGE_SIZE), [recentPage, savedTick, refresh]);

  // Newest saved stick, shown until the PLC sends a record in this run.
  const newestId = recentPage === 1 ? recent.data?.items[0]?.id : undefined;
  const newest = useQuery(connected && !last && newestId != null, () => db.detail(newestId!), [newestId]);
  const current = last
    ? last
    : newest.data
      ? { record: newest.data.record, receivedAt: newest.data.receivedAt, save: { state: "saved" as const, id: newest.data.id } }
      : undefined;

  const sku = active.confirmed?.handshake.actSku || undefined;
  const chart = useQuery(connected && !!sku, () => db.list({ productCode: sku }, 1, CHART_SIZE), [sku, savedTick, refresh], false);
  const error = stats.error || recent.error || chart.error || newest.error;

  return (
    <div className="monitor-page">
      <PageHeader title="1 · Giám sát" />
      {error && <Alert type="error" showIcon title={error} />}

      <section className="monitor-top" aria-label="Tổng quan">
        <Card className="section-card">
          <div className="kicker">SKU đang chạy</div>
          <strong className="monitor-sku">{sku ?? "0"}</strong>
          <div>Khách hàng: {active.customer || "0"}</div>
          {active.isLive && <Tag color="green">Trực tiếp từ PLC</Tag>}
          {!active.isLive && active.confirmed && <small className="monitor-recipe-note">
            Giá trị xác nhận gần nhất: {fmtDateTime(active.confirmed.readAt)}
          </small>}
        </Card>
        <PlcStateCard />
        <SummaryCards stats={stats.data} loading={stats.loading} startedAt={info?.startedAt} />
      </section>

      <section className="monitor-mid">
        <CurrentStick
          current={current}
          loading={recent.loading || newest.loading}
          onOpen={() =>
            current &&
            openStick(
              current.save.state === "saved"
                ? { id: current.save.id }
                : { record: current.record, receivedAt: current.receivedAt },
            )
          }
        />
        <BendChart rows={chart.data?.items ?? []} loading={chart.loading} sku={sku}
          recipe={active.recipe} recipeNote={!active.recipe ? "Chưa đồng bộ công thức"
            : !active.isLive ? "Thông số theo trạng thái PLC xác nhận gần nhất, chưa có xác nhận trực tiếp mới." : undefined}
          recipeError={active.recipeError} />
      </section>

      <RecentTable
        page={recentPage}
        data={recent.data}
        loading={recent.loading}
        onPage={setRecentPage}
        onRefresh={() => setRefresh((n) => n + 1)}
        onOpen={(id) => openStick({ id })}
      />

    </div>
  );
}
