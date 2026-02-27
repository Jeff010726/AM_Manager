PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'visitor')),
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  unit TEXT NOT NULL,
  spec TEXT,
  safety_stock_qty INTEGER NOT NULL DEFAULT 0 CHECK (safety_stock_qty >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_code TEXT NOT NULL UNIQUE,
  project_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned', 'active', 'blocked', 'done', 'cancelled')),
  owner_user_id INTEGER NOT NULL,
  start_date TEXT,
  end_date TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS project_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  project_role TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  UNIQUE(project_id, user_id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS project_commits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  seq_no INTEGER NOT NULL,
  author_user_id INTEGER NOT NULL,
  author_system_role TEXT NOT NULL CHECK (author_system_role IN ('admin', 'visitor')),
  author_project_role TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status_from TEXT CHECK (status_from IN ('planned', 'active', 'blocked', 'done', 'cancelled')),
  status_to TEXT NOT NULL CHECK (status_to IN ('planned', 'active', 'blocked', 'done', 'cancelled')),
  progress_pct INTEGER CHECK (progress_pct >= 0 AND progress_pct <= 100),
  created_at TEXT NOT NULL,
  request_id TEXT NOT NULL,
  UNIQUE(project_id, seq_no),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (author_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS project_material_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  planned_qty INTEGER NOT NULL CHECK (planned_qty >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, product_id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS project_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  consumed_qty INTEGER NOT NULL DEFAULT 0 CHECK (consumed_qty >= 0),
  released_qty INTEGER NOT NULL DEFAULT 0 CHECK (released_qty >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS project_consumptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  note TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (reservation_id) REFERENCES project_reservations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS inventory_balances (
  product_id INTEGER PRIMARY KEY,
  on_hand_qty INTEGER NOT NULL DEFAULT 0,
  in_transit_qty INTEGER NOT NULL DEFAULT 0,
  reserved_qty INTEGER NOT NULL DEFAULT 0,
  consumed_qty INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  operation_type TEXT NOT NULL,
  qty INTEGER NOT NULL,
  delta_on_hand INTEGER NOT NULL DEFAULT 0,
  delta_in_transit INTEGER NOT NULL DEFAULT 0,
  delta_reserved INTEGER NOT NULL DEFAULT 0,
  delta_consumed INTEGER NOT NULL DEFAULT 0,
  project_id INTEGER,
  reservation_id INTEGER,
  reason TEXT,
  actor_user_id INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (reservation_id) REFERENCES project_reservations(id),
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(key, endpoint),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_members_project ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_members_user ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_commits_project_created ON project_commits(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plans_project ON project_material_plans(project_id);
CREATE INDEX IF NOT EXISTS idx_reservations_project ON project_reservations(project_id);
CREATE INDEX IF NOT EXISTS idx_reservations_product ON project_reservations(product_id);
CREATE INDEX IF NOT EXISTS idx_consumptions_project ON project_consumptions(project_id);
CREATE INDEX IF NOT EXISTS idx_inventory_tx_product_created ON inventory_transactions(product_id, created_at DESC);

INSERT OR IGNORE INTO users (id, email, name, role, password_hash, status, created_at, updated_at)
VALUES
  (1, 'admin@example.com', 'System Admin', 'admin', '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', 'active', datetime('now'), datetime('now')),
  (2, 'visitor@example.com', 'Project Visitor', 'visitor', '5c1e1b5c8936669bfe844210fb7ae7d3411dd9f41614d09ce9732dfc17c266bc', 'active', datetime('now'), datetime('now'));

