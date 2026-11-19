CREATE TABLE school_calendar (
  date TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'off' CHECK (kind IN ('off','school')),
  label TEXT,
  school_year TEXT NOT NULL
);
CREATE INDEX idx_calendar_year ON school_calendar (school_year);
