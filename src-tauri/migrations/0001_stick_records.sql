-- Stick measurement records read from the X212PI PLC (record UDT_StickData, 240 registers).
-- One PLC record -> 1 stick + 2 station_result + up to 8 point_result + up to 32 attempt rows.
-- Register offsets: src-tauri/src/plc/registers.rs.
-- Values written by the PLC are stored as-is (no range checks) so an odd value never loses a record.
-- Result codes: 0 = not measured, 1 = OK, 2 = NG.

-- General info of the record (offsets 0..23).
CREATE TABLE stick (
    id              BIGSERIAL   PRIMARY KEY,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),  -- time the PC read the record
    record_seq      INTEGER     NOT NULL,                -- RecordSeq (TotalCount when written)
    stick_no        INTEGER     NOT NULL,                -- StickNo
    product_code    VARCHAR(20) NOT NULL,                -- ProductCode (ASCII, 10 words)
    format_version  SMALLINT    NOT NULL,                -- Version
    status_raw      INTEGER     NOT NULL,                -- Status bit field (u16)
    overall_result  SMALLINT    NOT NULL,                -- OverallResult
    raw_words       BYTEA       NOT NULL                 -- 240 words, little-endian
);
CREATE INDEX stick_received_at_idx ON stick (received_at);
CREATE INDEX stick_product_idx     ON stick (product_code, received_at);

-- Station 2 (BUTT) and 3 (TIP). Always 2 rows per stick.
CREATE TABLE station_result (
    stick_id     BIGINT   NOT NULL REFERENCES stick (id) ON DELETE CASCADE,
    station      TEXT     NOT NULL CHECK (station IN ('BUTT', 'TIP')),
    result       SMALLINT NOT NULL,
    point_count  SMALLINT NOT NULL,
    ng_point     SMALLINT NOT NULL,  -- 0 if OK
    load_g       REAL     NOT NULL,
    PRIMARY KEY (stick_id, station)
);

-- Measuring points P1..P4. Only points actually measured (point_no <= point_count).
CREATE TABLE point_result (
    stick_id        BIGINT   NOT NULL,
    station         TEXT     NOT NULL,
    point_no        SMALLINT NOT NULL CHECK (point_no BETWEEN 1 AND 4),
    result          SMALLINT NOT NULL,
    attempt_count   SMALLINT NOT NULL,
    decide_attempt  SMALLINT NOT NULL,
    position_mm     REAL     NOT NULL,
    PRIMARY KEY (stick_id, station, point_no),
    FOREIGN KEY (stick_id, station) REFERENCES station_result ON DELETE CASCADE
);

-- Attempts A1..A4 at one point, rotated 90 degrees each. Only attempt_no <= attempt_count.
CREATE TABLE attempt (
    stick_id      BIGINT   NOT NULL,
    station       TEXT     NOT NULL,
    point_no      SMALLINT NOT NULL,
    attempt_no    SMALLINT NOT NULL CHECK (attempt_no BETWEEN 1 AND 4),
    angle_deg     SMALLINT GENERATED ALWAYS AS ((attempt_no - 1) * 90) STORED,
    push_dist_mm  REAL     NOT NULL,
    bend_mm       REAL     NOT NULL,
    PRIMARY KEY (stick_id, station, point_no, attempt_no),
    FOREIGN KEY (stick_id, station, point_no) REFERENCES point_result ON DELETE CASCADE
);

-- One row per measured point with the attempt that decided its result.
CREATE VIEW point_decided AS
SELECT s.id AS stick_id, s.received_at, s.product_code, s.stick_no,
       p.station, p.point_no, p.result, p.position_mm,
       p.decide_attempt, a.angle_deg, a.push_dist_mm, a.bend_mm
FROM stick s
JOIN point_result p ON p.stick_id = s.id
LEFT JOIN attempt a ON a.stick_id = p.stick_id AND a.station = p.station
                   AND a.point_no = p.point_no AND a.attempt_no = p.decide_attempt;
