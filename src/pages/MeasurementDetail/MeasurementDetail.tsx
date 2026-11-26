import { useEffect, useState } from "react";
import { Alert, Button, Card, Empty, Spin, Table, Tag } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useLocation, useNavigate, useParams } from "react-router";
import PageHeader from "../../components/PageHeader";
import { ResultTag } from "../../components/Result";
import { attemptCount, decidingAttempt, measuredPoints, stationOf, type StationKey } from "../../components/stick";
import { db, errorText } from "../../lib/db";
import { PLC_LOAD_SOURCE, fmtDateTime, fmtKg, fmtNum } from "../../lib/format";
import type { Attempt, Point, StickRecord } from "../../lib/plc";
import type { MeasurementNavigation } from "../../lib/useOpenStick";
import "./MeasurementDetail.css";
import { skuMismatch } from "../../lib/production";

type PointRow = Point & { n: number };
type AttemptRow = Attempt & { n: number };
type Detail = { record: StickRecord; receivedAt: Date | string; plcProductCode?: string };

function Attempts({ point }: { point: Point }) {
  const rows = point.attempts.slice(0, attemptCount(point)).map((a, i) => ({ ...a, n: i + 1 }));
  const columns: ColumnsType<AttemptRow> = [
    { title: "Lượt đo", dataIndex: "n", width: 120 },
    { title: "Góc đo", render: (_, a) => `${(a.n - 1) * 90}°`, width: 120 },
    { title: "Lực đè thực tế (kg)", dataIndex: "pushDist", render: (v) => fmtNum(v, 2), width: 220 },
    { title: "Độ cong (mm)", dataIndex: "bend", render: (v) => fmtNum(v), width: 180 },
    { title: "Lượt quyết định", render: (_, a) => a.n === point.decideAttempt ? <Tag color="blue">Quyết định</Tag> : "—", width: 180 },
  ];
  return <Table<AttemptRow> className="measurement-attempts" rowKey="n" pagination={false}
    columns={columns} dataSource={rows} scroll={{ x: 820 }}
    rowClassName={(a) => a.n === point.decideAttempt ? "attempt-decided" : ""} />;
}

function StationCard({ record, station }: { record: StickRecord; station: StationKey }) {
  const s = stationOf(record, station);
  const rows = measuredPoints(s).map((p, i) => ({ ...p, n: i + 1 }));
  const columns: ColumnsType<PointRow> = [
    { title: "Điểm", dataIndex: "n", render: (n) => `P${n}`, width: 80 },
    { title: "Vị trí đo (mm)", dataIndex: "position", render: (v) => fmtNum(v), width: 140 },
    { title: "Kết quả", dataIndex: "result", render: (v) => <ResultTag value={v} />, width: 100 },
    { title: "Số lượt đo", render: (_, p) => attemptCount(p), width: 115 },
    { title: "Lượt quyết định", render: (_, p) => decidingAttempt(p) ? p.decideAttempt : "—", width: 150 },
    { title: "Số lần đo lại", render: (_, p) => Math.max(0, attemptCount(p) - 1), width: 130 },
    { title: "Lực đè thực tế lượt quyết định (kg)", render: (_, p) => fmtNum(decidingAttempt(p)?.pushDist, 2), width: 260 },
    { title: "Độ cong quyết định (mm)", render: (_, p) => fmtNum(decidingAttempt(p)?.bend), width: 210 },
  ];
  return <Card className="section-card measurement-station" title={`Trạm ${station}`}>
    <dl className="measurement-station-summary">
      <div title={PLC_LOAD_SOURCE}><dt>Lực đè cài đặt</dt><dd>{fmtKg(s.load)} kg</dd></div>
      <div><dt>Kết quả</dt><dd><ResultTag value={s.result} /></dd></div>
      <div><dt>Số điểm đo</dt><dd>{s.pointCount}</dd></div>
      <div><dt>Điểm NG</dt><dd>{s.ngPoint > 0 ? `P${s.ngPoint}` : "—"}</dd></div>
    </dl>
    <Table<PointRow> className="measurement-points" rowKey="n" pagination={false}
      columns={columns} dataSource={rows} scroll={{ x: 1233 }}
      expandable={{ columnWidth: 48, expandedRowRender: (p) => <Attempts point={p} />, rowExpandable: (p) => attemptCount(p) > 0 }}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Trạm này không có điểm đo" /> }} />
  </Card>;
}

export default function MeasurementDetail() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = location.state as MeasurementNavigation | null;
  const liveSource = id === "live" && navigation?.source && "record" in navigation.source ? navigation.source : undefined;
  const [loaded, setLoaded] = useState<Detail>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (id === "live") return;
    const savedId = Number(id);
    if (!Number.isSafeInteger(savedId) || savedId <= 0) {
      setError("Mã phép đo không hợp lệ.");
      return;
    }
    let active = true;
    db.detail(savedId).then((detail) => {
      if (!active) return;
      if (detail) setLoaded(detail);
      else setError("Không tìm thấy phép đo này trong cơ sở dữ liệu.");
    }).catch((e) => active && setError(errorText(e)));
    return () => { active = false; };
  }, [id]);

  const shown = liveSource ?? loaded;
  const shownError = id === "live" && !liveSource ? "Bản ghi live không còn khả dụng. Hãy quay lại Giám sát và mở lại bản ghi." : error;
  return <div className="measurement-detail-page">
    <PageHeader title="Chi tiết phép đo" extra={<Button icon={<ArrowLeftOutlined />}
      onClick={() => navigation?.background ? navigate(-1) : navigate(id === "live" ? "/monitor" : "/history", { replace: true })}>Quay lại</Button>} />
    {shownError ? <Alert type="error" showIcon title={shownError} /> : !shown ? <Spin /> : <>
      {skuMismatch(shown.record.productCode, shown.plcProductCode) &&
        <Alert type="warning" showIcon title={skuMismatch(shown.record.productCode, shown.plcProductCode)} />}
      <Card className="section-card" title="Thông tin chung">
        <dl className="measurement-info">
          <div><dt>Mã phép đo</dt><dd>{id === "live" ? "Bản ghi live · Chưa có mã lưu" : `#${id}`}</dd></div>
          <div><dt>SKU</dt><dd>{shown.record.productCode || "—"}</dd></div>
          <div><dt>SKU gốc PLC</dt><dd>{shown.plcProductCode || "—"}</dd></div>
          <div><dt>Số gậy</dt><dd>#{shown.record.stickNo}</dd></div>
          <div><dt>Thời gian nhận</dt><dd>{fmtDateTime(shown.receivedAt)}</dd></div>
          <div><dt>RecordSeq</dt><dd>{shown.record.recordSeq}</dd></div>
          <div><dt>Kết quả tổng thể</dt><dd><ResultTag value={shown.record.overallResult} /></dd></div>
        </dl>
      </Card>
      <StationCard record={shown.record} station="BUTT" />
      <StationCard record={shown.record} station="TIP" />
      <p className="measurement-note">Nhấn + để xem các lượt đo. Hàng tô xanh là lượt quyết định kết quả của điểm.</p>
    </>}
  </div>;
}
