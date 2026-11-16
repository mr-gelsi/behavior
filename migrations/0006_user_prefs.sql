CREATE TABLE user_prefs (
  user_type TEXT NOT NULL CHECK (user_type IN ('staff','student')),
  user_ref TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user_type, user_ref, key)
);
