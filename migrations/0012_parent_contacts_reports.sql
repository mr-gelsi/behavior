ALTER TABLE students ADD COLUMN guardian_name TEXT;
ALTER TABLE students ADD COLUMN guardian_email TEXT;
ALTER TABLE students ADD COLUMN guardian_email2 TEXT;
ALTER TABLE students ADD COLUMN no_email INTEGER NOT NULL DEFAULT 0;
ALTER TABLE students ADD COLUMN restroom_exempt INTEGER NOT NULL DEFAULT 0;
CREATE TABLE parent_notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('steps','restroom')),
  scope TEXT NOT NULL,
  student_id INTEGER NOT NULL REFERENCES students (student_id),
  level INTEGER NOT NULL DEFAULT 0,
  sent_by INTEGER REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (kind, scope, student_id, level)
);
CREATE INDEX idx_parent_notices_student ON parent_notices (student_id);
