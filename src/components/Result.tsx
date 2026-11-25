import { Tag } from "antd";
import type { ResultCode } from "../lib/db";

export const resultLabel = (v: ResultCode | null | undefined) => (v === 1 ? "OK" : v === 2 ? "NG" : "Chưa đo");
const tone = (v: ResultCode | null | undefined) => (v === 1 ? "ok" : v === 2 ? "ng" : "none");

/** 0 / null not measured, 1 OK, 2 NG. */
export function ResultTag({ value }: { value: ResultCode | null | undefined }) {
  return <Tag color={value === 1 ? "green" : value === 2 ? "red" : "default"}>{resultLabel(value)}</Tag>;
}

/** BUTT / TIP / OVERALL tiles of one stick. */
export function ResultTiles({ butt, tip, overall }: { butt?: ResultCode; tip?: ResultCode; overall?: ResultCode }) {
  const tiles: [string, ResultCode | undefined, boolean][] = [
    ["BUTT", butt, false],
    ["TIP", tip, false],
    ["OVERALL", overall, true],
  ];
  return (
    <div className="result-tiles">
      {tiles.map(([label, v, solid]) => (
        <div key={label} className={`result-tile result-tile-${tone(v)}${solid ? " result-tile-solid" : ""}`}>
          <span>{label}</span>
          <strong>{v == null ? "—" : resultLabel(v)}</strong>
        </div>
      ))}
    </div>
  );
}
