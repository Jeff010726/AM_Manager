PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS finished_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_product_id INTEGER NOT NULL UNIQUE,
  product_name TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (sku_product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS finished_product_bom_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finished_product_id INTEGER NOT NULL,
  material_product_id INTEGER NOT NULL,
  qty_per_set INTEGER NOT NULL CHECK (qty_per_set > 0),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(finished_product_id, material_product_id),
  FOREIGN KEY (finished_product_id) REFERENCES finished_products(id),
  FOREIGN KEY (material_product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_finished_products_status ON finished_products(status);
CREATE INDEX IF NOT EXISTS idx_finished_product_bom_product ON finished_product_bom_items(finished_product_id);
CREATE INDEX IF NOT EXISTS idx_finished_product_bom_material ON finished_product_bom_items(material_product_id);
