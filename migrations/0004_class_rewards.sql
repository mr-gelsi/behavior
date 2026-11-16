ALTER TABLE store_items ADD COLUMN owner_id INTEGER REFERENCES users (id);
ALTER TABLE classes ADD COLUMN rewards_configured INTEGER NOT NULL DEFAULT 0;
CREATE TABLE class_rewards (
  class_id INTEGER NOT NULL REFERENCES classes (id),
  item_id INTEGER NOT NULL REFERENCES store_items (id),
  PRIMARY KEY (class_id, item_id)
);
CREATE INDEX idx_class_rewards_item ON class_rewards (item_id);
CREATE INDEX idx_store_items_owner ON store_items (owner_id);
