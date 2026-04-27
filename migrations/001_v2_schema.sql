-- Yard Manager v2 schema
-- Voegt areas + cells toe (cells vervangt yard_layout in v2)
-- Legacy tabellen (yard_cells, yard_layout, balen_items) blijven bestaan voor backward compat.

-- ── areas ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS areas (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(120) NOT NULL DEFAULT '',
  area_type     VARCHAR(40)  NOT NULL,
  color         VARCHAR(20),
  material_name VARCHAR(120),
  material_id   INTEGER,
  metadata      JSONB DEFAULT '{}'::jsonb,
  updated_at    BIGINT NOT NULL,
  deleted_at    BIGINT
);

CREATE INDEX IF NOT EXISTS idx_areas_updated ON areas(updated_at);
CREATE INDEX IF NOT EXISTS idx_areas_type    ON areas(area_type);

-- ── cells ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cells (
  col         INTEGER NOT NULL,
  row         INTEGER NOT NULL,
  area_id     INTEGER REFERENCES areas(id) ON DELETE SET NULL,
  cell_type   VARCHAR(30) NOT NULL,
  label       VARCHAR(80) DEFAULT '',
  meta        JSONB DEFAULT '{}'::jsonb,
  updated_at  BIGINT NOT NULL,
  deleted_at  BIGINT,
  PRIMARY KEY (col, row)
);

CREATE INDEX IF NOT EXISTS idx_cells_area    ON cells(area_id);
CREATE INDEX IF NOT EXISTS idx_cells_updated ON cells(updated_at);

-- ── area_contents (toekomstig — quantities per area) ──────────────────────
CREATE TABLE IF NOT EXISTS area_contents (
  id            SERIAL PRIMARY KEY,
  area_id       INTEGER REFERENCES areas(id) ON DELETE CASCADE,
  material_name VARCHAR(120),
  material_id   INTEGER,
  quantity      NUMERIC,
  unit          VARCHAR(20),
  notes         TEXT,
  updated_at    BIGINT NOT NULL,
  deleted_at    BIGINT
);

CREATE INDEX IF NOT EXISTS idx_area_contents_area ON area_contents(area_id);
