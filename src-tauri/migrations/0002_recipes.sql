-- Recipe settings are independent of measurement results.
-- NULL means not configured; zero remains a real operator-entered value.
CREATE TABLE recipes (
    id          BIGSERIAL PRIMARY KEY,
    customer    TEXT NOT NULL CHECK (customer IN ('TM', 'MCC')),
    sku         VARCHAR(20) NOT NULL UNIQUE
                CHECK (length(sku) > 0 AND octet_length(sku) = length(sku)),
    recipe_rev  INTEGER NOT NULL DEFAULT 0 CHECK (recipe_rev >= 0),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE recipe_stations (
    recipe_id   BIGINT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    station     TEXT NOT NULL CHECK (station IN ('BUTT', 'TIP')),
    enabled     SMALLINT CHECK (enabled IN (0, 1)),
    num_points  SMALLINT CHECK (num_points BETWEEN 1 AND 10),
    max_rot     SMALLINT CHECK (max_rot BETWEEN 0 AND 3),
    settle_time SMALLINT CHECK (settle_time >= 0), -- signed INT, units of 100 ms
    load_tol    DOUBLE PRECISION CHECK (load_tol >= 0 AND load_tol < 'Infinity'::float8),
    bend_tol    DOUBLE PRECISION CHECK (bend_tol >= 0 AND bend_tol < 'Infinity'::float8),
    points      JSONB NOT NULL CHECK (jsonb_typeof(points) = 'array' AND jsonb_array_length(points) = 10),
    PRIMARY KEY (recipe_id, station)
);

INSERT INTO recipes (customer, sku) VALUES
    ('TM', 'MH1253R'), ('TM', 'MH1144S'), ('TM', 'IG792L'),
    ('TM', 'IG1019S'), ('TM', 'IG740S'),
    ('MCC', 'MH1287S'), ('MCC', 'IH1279S'), ('MCC', 'IH1390S'),
    ('MCC', 'MH1404R'), ('MCC', 'IH1409R');

INSERT INTO recipe_stations (recipe_id, station, points)
SELECT r.id, s.station,
       (SELECT jsonb_agg(jsonb_build_object(
           'posLinear', NULL, 'posPressFixed', NULL, 'posForce', NULL,
           'load', NULL, 'bend', NULL)) FROM generate_series(0, 9))
FROM recipes r CROSS JOIN (VALUES ('BUTT'), ('TIP')) AS s(station);
