ALTER TABLE users ADD COLUMN last_name TEXT;
UPDATE users SET last_name = replace(name, rtrim(name, replace(name, ' ', '')), '') WHERE last_name IS NULL;
