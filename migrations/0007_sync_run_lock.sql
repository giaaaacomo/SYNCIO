CREATE TABLE sync_run_locks (
  user_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  lease_until TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
