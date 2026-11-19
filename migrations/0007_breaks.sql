CREATE TABLE teacher_pins (
  user_id INTEGER PRIMARY KEY REFERENCES users (id),
  pin_hash TEXT NOT NULL UNIQUE,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE break_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students (student_id),
  reason TEXT NOT NULL CHECK (reason IN ('restroom','water')),
  break_date TEXT NOT NULL,
  left_at TEXT NOT NULL,
  returned_at TEXT,
  released_by INTEGER REFERENCES users (id),
  status TEXT NOT NULL DEFAULT 'out' CHECK (status IN ('out','returned')),
  return_method TEXT CHECK (return_method IS NULL OR return_method IN ('student','staff','auto')),
  school_year TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_break_open ON break_log (student_id) WHERE status = 'out';
CREATE INDEX idx_break_date ON break_log (break_date);
CREATE INDEX idx_break_student ON break_log (student_id, break_date);
