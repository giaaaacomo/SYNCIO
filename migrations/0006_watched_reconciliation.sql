ALTER TABLE sync_settings
ADD COLUMN watched_export_delay_hours INTEGER NOT NULL DEFAULT 6;

CREATE TABLE watched_reconciliation_candidates (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  direction TEXT NOT NULL,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX watched_reconciliation_candidates_user
ON watched_reconciliation_candidates(user_id);
