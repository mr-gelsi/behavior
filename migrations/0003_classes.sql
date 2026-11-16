CREATE TABLE classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users (id),
  name TEXT NOT NULL,
  period TEXT,
  school_year TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  join_open INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  grid_cols INTEGER NOT NULL DEFAULT 8 CHECK (grid_cols BETWEEN 2 AND 16),
  grid_rows INTEGER NOT NULL DEFAULT 6 CHECK (grid_rows BETWEEN 2 AND 12),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_classes_owner ON classes (owner_id, archived);
CREATE TABLE class_members (
  class_id INTEGER NOT NULL REFERENCES classes (id),
  student_id INTEGER NOT NULL REFERENCES students (student_id),
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  source TEXT NOT NULL DEFAULT 'code' CHECK (source IN ('code','teacher')),
  PRIMARY KEY (class_id, student_id)
);
CREATE INDEX idx_class_members_student ON class_members (student_id);
CREATE TABLE class_desks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes (id),
  x INTEGER NOT NULL CHECK (x BETWEEN 0 AND 15),
  y INTEGER NOT NULL CHECK (y BETWEEN 0 AND 11),
  kind TEXT NOT NULL DEFAULT 'desk' CHECK (kind IN ('desk','teacher')),
  student_id INTEGER REFERENCES students (student_id)
);
CREATE UNIQUE INDEX uq_desk_cell ON class_desks (class_id, x, y);
CREATE UNIQUE INDEX uq_desk_student ON class_desks (class_id, student_id) WHERE student_id IS NOT NULL;
