-- Starter data. No student data is included.

INSERT INTO p5_categories (id, name, emoji, color, sort) VALUES
  (1, 'Prompt',     '⏰', '#4f8cff', 1),
  (2, 'Prepared',   '🎒', '#9b6bff', 2),
  (3, 'Positive',   '😊', '#f2b01e', 3),
  (4, 'Polite',     '🤝', '#f06fa8', 4),
  (5, 'Productive', '💪', '#3fbf7f', 5);

INSERT INTO settings (key, value) VALUES
  ('school_name', 'Your School'),
  ('nonqual_min_step', '2'),
  ('nonqual_step1_count', '2'),
  ('teacher_max_p5', '10'),
  ('allow_negative_balance', '1'),
  ('code_label', 'Code');

-- 2025-26 reward periods (from the original workbook). Add 2026-27 in Admin.
INSERT INTO reward_periods (school_year, name, start_date, end_date) VALUES
  ('2025-26', 'Rewards 1',  '2025-08-13', '2025-09-08'),
  ('2025-26', 'Rewards 2',  '2025-09-08', '2025-10-10'),
  ('2025-26', 'Rewards 3',  '2025-10-13', '2025-11-14'),
  ('2025-26', 'Rewards 4',  '2025-11-17', '2025-12-05'),
  ('2025-26', 'Rewards 5',  '2025-12-06', '2026-01-09'),
  ('2025-26', 'Rewards 6',  '2026-01-12', '2026-02-05'),
  ('2025-26', 'Rewards 7',  '2026-02-08', '2026-03-13'),
  ('2025-26', 'Rewards 8',  '2026-03-16', '2026-04-03'),
  ('2025-26', 'Rewards 9',  '2026-04-07', '2026-04-30'),
  ('2025-26', 'Rewards 10', '2026-05-01', '2026-06-01');

INSERT INTO store_items (name, description, price, stock, max_per_student, emoji, active) VALUES
  ('Homework pass', 'Skip one homework assignment (teacher approval).', 25, NULL, 2, '📝', 1),
  ('Pencil', 'A fresh pencil.', 5, 100, NULL, '✏️', 1),
  ('Sit with a friend', 'Choose your seat for a day.', 15, NULL, NULL, '🪑', 1);
