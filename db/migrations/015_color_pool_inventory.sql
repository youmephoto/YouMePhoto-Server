-- Migration 015: Color Pool Inventory
-- Ersetzt varianten-basiertes Inventar durch farb-basiertes Inventar
-- Alle Fotoboxen sind physisch gleich - Verfügbarkeit wird pro Farbe verwaltet

-- ==========================================
-- 1. COLOR_POOLS TABELLE
-- ==========================================
-- Speichert die physische Anzahl der Fotoboxen pro Farbe
CREATE TABLE IF NOT EXISTS color_pools (
  color TEXT PRIMARY KEY,           -- 'weiss', 'schwarz', 'rosa', 'mint'
  total_units INTEGER NOT NULL DEFAULT 1,
  display_name TEXT NOT NULL,       -- 'Weiß', 'Schwarz', 'Rosa', 'Mint'
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Initiale Werte
INSERT INTO color_pools (color, total_units, display_name) VALUES
  ('weiss', 6, 'Weiß'),
  ('schwarz', 2, 'Schwarz'),
  ('rosa', 1, 'Rosa'),
  ('mint', 1, 'Mint')
ON CONFLICT(color) DO NOTHING;

-- ==========================================
-- 2. COLOR SPALTE IN VARIANT_INVENTORY
-- ==========================================
-- Normalisierte Farbe für schnellen DB-Lookup (statt String-Matching zur Laufzeit)
ALTER TABLE variant_inventory ADD COLUMN IF NOT EXISTS color TEXT;

-- Populiere color aus variant_title
UPDATE variant_inventory SET color = CASE
  WHEN lower(variant_title) LIKE '%wei%' OR lower(variant_title) LIKE '%white%' THEN 'weiss'
  WHEN lower(variant_title) LIKE '%schwarz%' OR lower(variant_title) LIKE '%black%' THEN 'schwarz'
  WHEN lower(variant_title) LIKE '%rosa%' OR lower(variant_title) LIKE '%pink%' OR lower(variant_title) LIKE '%ros%' THEN 'rosa'
  WHEN lower(variant_title) LIKE '%mint%' OR lower(variant_title) LIKE '%türk%' OR lower(variant_title) LIKE '%turk%' THEN 'mint'
  ELSE lower(variant_title)
END
WHERE color IS NULL;

CREATE INDEX IF NOT EXISTS idx_variant_inventory_color ON variant_inventory(color);

-- ==========================================
-- 3. COLOR_SCHEDULE TABELLE
-- ==========================================
-- Zeitbasierte Vorplanung pro Farbe (statt pro variant_gid)
-- Beispiel: "Ab 01.06. haben wir 7x Weiß"
CREATE TABLE IF NOT EXISTS color_schedule (
  id SERIAL PRIMARY KEY,
  color TEXT NOT NULL REFERENCES color_pools(color) ON DELETE CASCADE,
  effective_date TEXT NOT NULL,     -- YYYY-MM-DD, ab wann diese Anzahl gilt
  total_units INTEGER NOT NULL,
  note TEXT,                        -- z.B. "Neue Box aus Produktion"
  created_by TEXT DEFAULT 'admin',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_color_schedule_color ON color_schedule(color);
CREATE INDEX IF NOT EXISTS idx_color_schedule_date ON color_schedule(effective_date);
CREATE INDEX IF NOT EXISTS idx_color_schedule_color_date ON color_schedule(color, effective_date);

-- ==========================================
-- 4. COLOR_INVENTORY_HISTORY TABELLE
-- ==========================================
-- Audit-Trail für manuelle Inventar-Änderungen pro Farbe
CREATE TABLE IF NOT EXISTS color_inventory_history (
  id SERIAL PRIMARY KEY,
  color TEXT NOT NULL,
  old_quantity INTEGER,
  new_quantity INTEGER,
  changed_by TEXT,
  reason TEXT,
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
