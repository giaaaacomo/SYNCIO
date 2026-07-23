ALTER TABLE connections
  ADD COLUMN trakt_auth_mode TEXT NOT NULL DEFAULT 'direct-oauth'
  CHECK (trakt_auth_mode IN ('direct-oauth', 'stremio-delegated'));
