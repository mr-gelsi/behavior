-- Behavior Step Tracker schema (Cloudflare D1 / SQLite)
-- Dates are ISO text (YYYY-MM-DD). Timestamps are ISO UTC text.

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','teacher')),
  pw_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE students (
  student_id INTEGER PRIMARY KEY,
  last_name TEXT NOT NULL,
  first_name TEXT NOT NULL,
  grade INTEGER NOT NULL CHECK (grade IN (6,7,8)),
  homeroom_teacher TEXT,
  room TEXT,
  pin_hash TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_students_grade ON students (grade, last_name, first_name);

-- Server-side sessions. Only a SHA-256 hash of the cookie token is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_type TEXT NOT NULL CHECK (user_type IN ('staff','student')),
  user_ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);
CREATE INDEX idx_sessions_user ON sessions (user_type, user_ref);

CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX idx_login_attempts ON login_attempts (key, ts);

CREATE TABLE reward_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_year TEXT NOT NULL,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  UNIQUE (school_year, name)
);

CREATE TABLE p5_categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  emoji TEXT NOT NULL,
  color TEXT NOT NULL,
  sort INTEGER NOT NULL
);

CREATE TABLE steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students (student_id),
  step_level INTEGER NOT NULL CHECK (step_level BETWEEN 1 AND 5),
  step_date TEXT NOT NULL,
  teacher TEXT,
  period TEXT,
  code TEXT,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import','p5_fine')),
  p5_transaction_id INTEGER,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  school_year TEXT NOT NULL
);
CREATE INDEX idx_steps_student ON steps (student_id);
CREATE INDEX idx_steps_date ON steps (step_date);
CREATE INDEX idx_steps_year_level ON steps (school_year, step_level);

-- P5 points ledger. Balances are ALWAYS computed from this table.
CREATE TABLE p5_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students (student_id),
  type TEXT NOT NULL CHECK (type IN ('award','fine','purchase','refund','seat','seat_refund','adjustment')),
  category_id INTEGER REFERENCES p5_categories (id),
  amount INTEGER NOT NULL CHECK (amount <> 0),
  note TEXT,
  teacher TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  tx_date TEXT NOT NULL,
  linked_step_id INTEGER,
  related_id INTEGER,
  reversed_by INTEGER
);
CREATE INDEX idx_p5_student ON p5_transactions (student_id);
CREATE INDEX idx_p5_date ON p5_transactions (tx_date);

CREATE TABLE store_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  price INTEGER NOT NULL CHECK (price > 0),
  stock INTEGER CHECK (stock IS NULL OR stock >= 0),
  max_per_student INTEGER CHECK (max_per_student IS NULL OR max_per_student >= 1),
  emoji TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE store_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students (student_id),
  item_id INTEGER NOT NULL REFERENCES store_items (id),
  price_paid INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','fulfilled','cancelled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  fulfilled_by TEXT,
  fulfilled_at TEXT
);
CREATE INDEX idx_orders_status ON store_orders (status);
CREATE INDEX idx_orders_student ON store_orders (student_id);

CREATE TABLE reward_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  reward_date TEXT NOT NULL,
  reward_period_id INTEGER NOT NULL REFERENCES reward_periods (id),
  booking_opens_at TEXT NOT NULL,
  booking_closes_at TEXT NOT NULL,
  qualification_locked_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed'))
);

-- Frozen non-qualifier list, written when an Admin locks qualification.
CREATE TABLE reward_day_nonquals (
  reward_day_id INTEGER NOT NULL REFERENCES reward_days (id),
  student_id INTEGER NOT NULL REFERENCES students (student_id),
  why TEXT,
  PRIMARY KEY (reward_day_id, student_id)
);

CREATE TABLE reward_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reward_day_id INTEGER NOT NULL REFERENCES reward_days (id),
  name TEXT NOT NULL,
  description TEXT,
  location TEXT,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  p5_cost INTEGER NOT NULL DEFAULT 0 CHECK (p5_cost >= 0),
  kind TEXT NOT NULL DEFAULT 'regular' CHECK (kind IN ('regular','nonqual')),
  allowed_grades TEXT,
  created_by TEXT
);
CREATE INDEX idx_activities_day ON reward_activities (reward_day_id);

CREATE TABLE reward_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL REFERENCES reward_activities (id),
  reward_day_id INTEGER NOT NULL REFERENCES reward_days (id),
  student_id INTEGER NOT NULL REFERENCES students (student_id),
  assignment TEXT NOT NULL CHECK (assignment IN ('self','auto','manual')),
  p5_cost_paid INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- One confirmed seat per student per Rewards Day, enforced by the database.
CREATE UNIQUE INDEX uq_booking_one_per_day
  ON reward_bookings (reward_day_id, student_id) WHERE status = 'confirmed';
CREATE INDEX idx_bookings_activity ON reward_bookings (activity_id, status);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX idx_audit_ts ON audit_log (ts);
