import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Popconfirm, Spin, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useNavigate } from "react-router";
import { useControl, useLive, type SaveState } from "../../app/LiveProvider";
import BendChart from "../../components/BendChart";
import ControlAreaPanel from "../../components/ControlAreaPanel";
import PageHeader from "../../components/PageHeader";
import PointTable from "../../components/PointTable";
import { ResultTag, ResultTiles } from "../../components/Result";
import StickDrawer, { type StickSource } from "../../components/StickDrawer";
import { useQuery } from "../../lib/useQuery";
import { db, type StickPage, type StickRow, type StickStats } from "../../lib/db";
import { resetReadCount, type StickRecord } from "../../lib/plc";
import { fmtInt, fmtKg, fmtNum, fmtRate, fmtTime } from "../../lib/format";
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
  const { control, lastPoll, pollError } = useControl();
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
      <div className="kicker">Trạng thái PLC</div>
      <strong className={`monitor-machine monitor-machine-${tone}`}>{label}</strong>
      <div className="monitor-machine-detail">
        DataReady <Tag>{control?.dataReady ?? "—"}</Tag>
        <br />
        Lần đọc cuối {lastPoll ? fmtTime(lastPoll) : "—"}
      </div>
      {pollError && <div className="monitor-machine-error">{pollError.message}</div>}
      {plcStatus?.state === "disconnected" && <div className="monitor-machine-error">{plcStatus.reason}</div>}
    </Card>
  );
}

/** `stickNo`: StickNo of the last stick (not part of the control area). */
function CountersCard({ stickNo }: { stickNo?: number }) {
  const { plcStatus } = useLive();
  const { control } = useControl();
  const [resetting, setResetting] = useState(false);
  const reset = async () => {
    setResetting(true);
    try {
      await resetReadCount();
      message.success("Đã đặt PC_ReadCount về 0");
    } catch (e) {
      const msg = typeof e === "object" && e && "message" in e ? String(e.message) : String(e);
      message.error(`Không reset được PC_ReadCount: ${msg}`);
    } finally {
      setResetting(false);
    }
  };
  return (
    <Card className="section-card">
      <div className="kicker">Bộ đếm PLC</div>
      <dl className="monitor-counters">
        <div><dt>TotalCount</dt><dd>{fmtInt(control?.totalCount)}</dd></div>
        <div>
          <dt>PC_ReadCount</dt>
          <dd className="monitor-counter-reset">
            {fmtInt(control?.pcReadCount)}
            <Popconfirm title="Đặt PC_ReadCount về 0?" okText="Reset" cancelText="Huỷ" onConfirm={reset}>
              <Button size="small" loading={resetting} disabled={plcStatus?.state !== "connected"}>
                Reset
              </Button>
            </Popconfirm>
          </dd>
        </div>
        <div><dt>StickNo</dt><dd>{fmtInt(stickNo)}</dd></div>
      </dl>
    </Card>
  );
}

function SaveTag({ save }: { save: SaveState }) {
  if (save.state === "saved") return <Tag color="green">Đã lưu #{save.id}</Tag>;
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
      {current && (
        <div className="monitor-save">
          Lưu CSDL <SaveTag save={current.save} />
          {current.save.state === "error" && <span className="monitor-save-error">{current.save.message}</span>}
        </div>
      )}
      <PointTable record={r} loading={loading && !r} />
      {r && (
        <Button className="monitor-open" onClick={onOpen}>
          Xem 4 lần đo từng điểm
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
      { title: "Thời gian", dataIndex: "receivedAt", render: fmtTime, width: 110 },
      { title: "Số gậy", dataIndex: "stickNo", width: 90 },
      { title: "SKU", dataIndex: "productCode", render: (v) => v || "—", width: 140 },
      { title: "BUTT P1 / P2 / P3 / P4 (mm)", render: (_, r) => r.buttBends.map((v) => fmtNum(v)).join(" / ") },
      { title: "TIP (mm)", render: (_, r) => fmtNum(r.tipBends[0]), width: 100 },
      { title: "BUTT", dataIndex: "buttResult", render: (v) => <ResultTag value={v} />, width: 90 },
      { title: "TIP", dataIndex: "tipResult", render: (v) => <ResultTag value={v} />, width: 90 },
      { title: "Overall", dataIndex: "overallResult", render: (v) => <ResultTag value={v} />, width: 90 },
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
        scroll={{ x: 900 }}
        pagination={{ current: page, pageSize: RECENT_PAGE_SIZE, total: data?.total ?? 0, onChange: onPage, hideOnSinglePage: true, showSizeChanger: false }}
        onRow={(r) => ({ onClick: () => onOpen(r.id) })}
        locale={{ emptyText: "Chưa có gậy nào được lưu." }}
      />
    </Card>
  );
}

export default function Monitor() {
  const { dbStatus, info, last, savedTick } = useLive();
  const connected = dbStatus.connected;
  const [recentPage, setRecentPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [drawer, setDrawer] = useState<StickSource | null>(null);

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

  const sku = current?.record.productCode || undefined;
  const chart = useQuery(connected, () => db.list({ productCode: sku }, 1, CHART_SIZE), [sku, savedTick, refresh]);
  const error = stats.error || recent.error || chart.error || newest.error;

  return (
    <div className="monitor-page">
      <PageHeader title="1 · Giám sát" />
      {error && <Alert type="error" showIcon title={error} />}

      <section className="monitor-top" aria-label="Tổng quan">
        <Card className="section-card">
          <div className="kicker">SKU đang chạy</div>
          <strong className="monitor-sku">{sku ?? "N/A"}</strong>
        </Card>
        <PlcStateCard />
        <SummaryCards stats={stats.data} loading={stats.loading} startedAt={info?.startedAt} />
        <CountersCard stickNo={current?.record.stickNo} />
      </section>

      <section className="monitor-mid">
        <CurrentStick
          current={current}
          loading={recent.loading || newest.loading}
          onOpen={() =>
            current &&
            setDrawer(
              current.save.state === "saved"
                ? { id: current.save.id }
                : { record: current.record, receivedAt: current.receivedAt },
            )
          }
        />
        <BendChart rows={chart.data?.items ?? []} settings={info?.measurement} loading={chart.loading} />
      </section>

      <RecentTable
        page={recentPage}
        data={recent.data}
        loading={recent.loading}
        onPage={setRecentPage}
        onRefresh={() => setRefresh((n) => n + 1)}
        onOpen={(id) => setDrawer({ id })}
      />

      <ControlAreaPanel />
      <StickDrawer source={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}
