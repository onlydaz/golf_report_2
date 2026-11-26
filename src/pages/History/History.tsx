import { useEffect, useState } from "react";
import { Alert, Button, Card, DatePicker, Empty, InputNumber, Select, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import { useLive } from "../../app/LiveProvider";
import PageHeader from "../../components/PageHeader";
import StickTable from "../../components/StickTable";
import { useOpenStick } from "../../lib/useOpenStick";
import { db, type SkuSummary, type StickFilter } from "../../lib/db";
import { fmtDateTime, fmtInt, fmtRate } from "../../lib/format";
import { useQuery } from "../../lib/useQuery";
import "./History.css";

const PAGE_SIZE = 10;

interface Draft {
  from?: Dayjs | null;
  to?: Dayjs | null;
  productCode?: string;
  result?: number;
  stickNo?: number | null;
}

/** Whole days in local time: `from` at 00:00, `to` exclusive at 00:00 of the next day. */
function toFilter(d: Draft): StickFilter {
  return {
    from: d.from ? d.from.startOf("day").toISOString() : undefined,
    to: d.to ? d.to.add(1, "day").startOf("day").toISOString() : undefined,
    productCode: d.productCode,
    result: d.result,
    stickNo: d.stickNo ?? undefined,
  };
}

const skuColumns: ColumnsType<SkuSummary> = [
  { title: "SKU", dataIndex: "productCode", render: (v) => v || "Chưa gán SKU", align: "left" },
  { title: "Gậy đầu tiên", dataIndex: "firstAt", render: fmtDateTime },
  { title: "Gậy gần nhất", dataIndex: "lastAt", render: fmtDateTime },
  { title: "Tổng số gậy", dataIndex: "total", render: fmtInt },
  { title: "OK", dataIndex: "ok", render: fmtInt, className: "history-ok" },
  { title: "NG", dataIndex: "ng", render: fmtInt, className: "history-ng" },
  { title: "NG BUTT", dataIndex: "buttNg", render: fmtInt },
  { title: "NG TIP", dataIndex: "tipNg", render: fmtInt },
  { title: "Tỷ lệ OK", render: (_, r) => fmtRate(r.ok, r.total) },
];

export default function History() {
  const { dbStatus } = useLive();
  const connected = dbStatus.connected;
  const [draft, setDraft] = useState<Draft>({});
  const [filter, setFilter] = useState<StickFilter>({});
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [page, setPage] = useState(1);
  const openStick = useOpenStick();
  const [filterError, setFilterError] = useState("");

  const skuOptions = useQuery(connected, () => db.skus({}), [reload]);
  const stats = useQuery(connected, () => db.stats(filter), [filter, reload], false);
  const skus = useQuery(connected, () => db.skus(filter), [filter, reload], false);

  // Keep the selected SKU if it is still in the result, else take the most recent one.
  const skuList = skus.data;
  useEffect(() => {
    if (!skuList) return;
    setSelected((cur) => (cur !== undefined && skuList.some((s) => s.productCode === cur) ? cur : skuList[0]?.productCode));
  }, [skuList]);

  const sticks = useQuery(
    connected && selected !== undefined,
    () => db.list({ ...filter, productCode: selected }, page, PAGE_SIZE),
    [filter, selected, page, reload],
    false,
  );

  const apply = () => {
    if (draft.from && draft.to && draft.from.isAfter(draft.to, "day")) {
      setFilterError("Từ ngày phải trước hoặc bằng Đến ngày.");
      return;
    }
    setFilterError("");
    setSelected(undefined);
    setPage(1);
    setFilter(toFilter(draft));
  };
  const reset = () => {
    setDraft({});
    setSelected(undefined);
    setFilterError("");
    setPage(1);
    setFilter({});
  };

  const s = stats.data;
  const cards: [string, string, string][] = [
    ["Tổng số gậy", fmtInt(s?.total), "blue"],
    ["OK", fmtInt(s?.ok), "green"],
    ["NG", fmtInt(s?.ng), "red"],
    ["Tỷ lệ OK", s ? fmtRate(s.ok, s.total) : "—", "green"],
    ["NG BUTT", fmtInt(s?.buttNg), "red"],
    ["NG TIP", fmtInt(s?.tipNg), "red"],
  ];
  const total = sticks.data?.total ?? 0;
  const shownFrom = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const shownTo = Math.min(page * PAGE_SIZE, total);
  const error = stats.error || skus.error || sticks.error || skuOptions.error;

  return (
    <div className="history-page">
      <PageHeader title="2 · Lịch sử" />

      <Card className="section-card history-filters">
        <form
          className="history-filter-row"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <label className="filter-field">
            <span>Từ ngày</span>
            <DatePicker value={draft.from} format="DD/MM/YYYY" placeholder="Chọn ngày" onChange={(v) => setDraft((d) => ({ ...d, from: v }))} />
          </label>
          <label className="filter-field">
            <span>Đến ngày</span>
            <DatePicker value={draft.to} format="DD/MM/YYYY" placeholder="Chọn ngày" onChange={(v) => setDraft((d) => ({ ...d, to: v }))} />
          </label>
          <label className="filter-field">
            <span>SKU</span>
            <Select
              showSearch
              allowClear
              placeholder="Tất cả SKU"
              value={draft.productCode}
              loading={skuOptions.loading}
              options={(skuOptions.data ?? []).map((r) => ({ value: r.productCode, label: r.productCode || "Chưa gán SKU" }))}
              onChange={(v) => setDraft((d) => ({ ...d, productCode: v }))}
            />
          </label>
          <label className="filter-field">
            <span>Kết quả Overall</span>
            <Select
              allowClear
              placeholder="Tất cả"
              value={draft.result}
              options={[
                { value: 1, label: "OK" },
                { value: 2, label: "NG" },
                { value: 0, label: "Chưa đo" },
              ]}
              onChange={(v) => setDraft((d) => ({ ...d, result: v }))}
            />
          </label>
          <label className="filter-field">
            <span>Số gậy</span>
            <InputNumber
              min={-2147483648}
              max={2147483647}
              precision={0}
              placeholder="Số gậy"
              value={draft.stickNo ?? null}
              onChange={(v) => setDraft((d) => ({ ...d, stickNo: v }))}
            />
          </label>
          <div className="history-filter-actions">
            <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>Lọc</Button>
            <Button onClick={reset}>Đặt lại</Button>
          </div>
        </form>
        {filterError && <Alert type="warning" showIcon title={filterError} />}
      </Card>

      <div className="history-section-heading">
        <span>Toàn bộ kết quả theo bộ lọc đã áp dụng</span>
        <Button size="small" icon={<ReloadOutlined />} onClick={() => setReload((n) => n + 1)} disabled={!connected}>
          Tải lại
        </Button>
      </div>
      {error && <Alert type="error" showIcon title={error} />}

      <section className="history-stats" aria-label="Thống kê theo bộ lọc">
        {cards.map(([label, value, tone]) => (
          <Card key={label} className={`section-card history-stat history-stat-${tone}`}>
            <span>{label}</span>
            <strong>{value}</strong>
          </Card>
        ))}
      </section>

      <Card
        className="section-card"
        title="Các lần chạy theo SKU"
        extra={<span className="history-note">Hiển thị {skus.data?.length ?? 0} SKU · Chọn một dòng để xem gậy</span>}
      >
        <Table<SkuSummary>
          className="history-table history-sku-table"
          size="small"
          rowKey="productCode"
          loading={skus.loading}
          dataSource={skus.data}
          columns={skuColumns}
          pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
          scroll={{ x: 900 }}
          rowClassName={(r) => (r.productCode === selected ? "history-sku-selected" : "")}
          onRow={(r) => ({
            tabIndex: 0,
            onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(r.productCode); setPage(1); } },
            onClick: () => {
              setSelected(r.productCode);
              setPage(1);
            },
          })}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có gậy nào theo bộ lọc" /> }}
        />
      </Card>

      <Card
        className="section-card"
        title={selected !== undefined ? `Chi tiết gậy · ${selected || "Chưa gán SKU"}` : "Chi tiết gậy"}
        extra={<span className="history-note">Hiển thị {shownFrom}–{shownTo} / {fmtInt(total)} gậy</span>}
      >
        <StickTable
          spacious
          rows={selected !== undefined ? sticks.data?.items : []}
          total={total} page={page} onPage={setPage} onOpen={(id) => openStick({ id })}
          loading={sticks.loading}
          emptyText={selected === undefined ? "Chọn một SKU để xem chi tiết gậy" : "Không có gậy phù hợp"}
        />
      </Card>

    </div>
  );
}
