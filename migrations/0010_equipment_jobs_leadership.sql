-- Run this once. Adds: charger/computer check-out log, class jobs with applications and weekly pay, student leadership flag.
ALTER TABLE students ADD COLUMN leadership INTEGER NOT NULL DEFAULT 0;

CREATE TABLE equipment_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students (student_id),
  item TEXT NOT NULL CHECK (item IN ('charger','computer')),
  log_date TEXT NOT NULL,
  checked_out_at TEXT NOT NULL,
  returned_at TEXT,
  released_by INTEGER REFERENCES users (id),
  status TEXT NOT NULL DEFAULT 'out' CHECK (status IN ('out','returned')),
  return_method TEXT CHECK (return_method IS NULL OR return_method IN ('student','staff')),
  school_year TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_equipment_open ON equipment_log (student_id, item) WHERE status = 'out';
CREATE INDEX idx_equipment_date ON equipment_log (log_date);
CREATE INDEX idx_equipment_student ON equipment_log (student_id, log_date);

CREATE TABLE class_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes (id),
  title TEXT NOT NULL,
  description TEXT,
  salary INTEGER NOT NULL CHECK (salary BETWEEN 1 AND 100),
  slots INTEGER NOT NULL DEFAULT 1 CHECK (slots BETWEEN 1 AND 10),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_class_jobs_class ON class_jobs (class_id);

CREATE TABLE job_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES class_jobs (id),
  class_id INTEGER NOT NULL REFERENCES classes (id),
  student_id INTEGER NOT NULL REFERENCES students (student_id),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','hired','declined','withdrawn','ended')),
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  decided_at TEXT,
  decided_by TEXT,
  hired_on TEXT,
  ended_on TEXT
);
CREATE UNIQUE INDEX uq_job_app_open ON job_applications (job_id, student_id) WHERE status IN ('pending','hired');
CREATE UNIQUE INDEX uq_job_one_per_class ON job_applications (class_id, student_id) WHERE status = 'hired';
CREATE INDEX idx_job_app_class ON job_applications (class_id, status);

CREATE TABLE job_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES job_applications (id),
  pay_date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  paid_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (application_id, pay_date)
);
