CREATE TABLE rating_snapshots (
  user_id TEXT NOT NULL,
  media_key TEXT NOT NULL,
  stremio_status TEXT,
  trakt_rating INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, media_key),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_sync_conflicts_user_status
  ON sync_conflicts(user_id, status);
