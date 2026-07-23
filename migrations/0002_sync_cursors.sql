CREATE TABLE sync_cursors (
  user_id TEXT NOT NULL,
  cursor_key TEXT NOT NULL,
  cursor_value INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, cursor_key),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
