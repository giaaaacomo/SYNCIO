CREATE TABLE users (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  disabled_at TEXT
);

CREATE TABLE connections (
  user_id TEXT PRIMARY KEY,
  stremio_auth_ciphertext TEXT,
  stremio_user_id TEXT,
  trakt_client_id_ciphertext TEXT,
  trakt_client_secret_ciphertext TEXT,
  trakt_redirect_uri TEXT,
  trakt_access_ciphertext TEXT,
  trakt_refresh_ciphertext TEXT,
  trakt_expires_at TEXT,
  trakt_username TEXT,
  encryption_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE trakt_device_sessions (
  user_id TEXT PRIMARY KEY,
  device_code_ciphertext TEXT NOT NULL,
  user_code TEXT NOT NULL,
  verification_url TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  interval_seconds INTEGER NOT NULL,
  next_poll_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE sync_settings (
  user_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'account-preview',
  history_mode TEXT NOT NULL DEFAULT 'union',
  watched_enabled INTEGER NOT NULL DEFAULT 1,
  rating_sync_enabled INTEGER NOT NULL DEFAULT 1,
  library_watchlist_enabled INTEGER NOT NULL DEFAULT 1,
  removals_enabled INTEGER NOT NULL DEFAULT 0,
  like_threshold INTEGER NOT NULL DEFAULT 7,
  love_threshold INTEGER NOT NULL DEFAULT 9,
  sync_interval_minutes INTEGER NOT NULL DEFAULT 60,
  optional_catalogs_enabled INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE sync_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  planned_changes INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE change_ledger (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  first_applied_at TEXT NOT NULL,
  last_applied_at TEXT NOT NULL,
  applied_count INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE sync_conflicts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  media_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
