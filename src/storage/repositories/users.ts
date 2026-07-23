import type { D1DatabaseLike } from "../d1";

export interface UserRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
}

export interface HostedSyncSettings {
  scope: "test" | "account-preview" | "account";
  historyMode: "union";
  watchedEnabled: boolean;
  ratingSyncEnabled: boolean;
  libraryWatchlistEnabled: boolean;
  removalsEnabled: boolean;
  likeThreshold: number;
  loveThreshold: number;
  syncIntervalMinutes: number;
  optionalCatalogsEnabled: boolean;
}

export function defaultHostedSyncSettings(): HostedSyncSettings {
  return {
    scope: "account-preview",
    historyMode: "union",
    watchedEnabled: true,
    ratingSyncEnabled: true,
    libraryWatchlistEnabled: true,
    removalsEnabled: false,
    likeThreshold: 7,
    loveThreshold: 9,
    syncIntervalMinutes: 60,
    optionalCatalogsEnabled: false
  };
}

export async function getUser(db: D1DatabaseLike, userId: string): Promise<UserRecord | null> {
  const row = await db
    .prepare("SELECT id, created_at, updated_at, disabled_at FROM users WHERE id = ?")
    .bind(userId)
    .first<Record<string, unknown>>();
  return row ? parseUser(row) : null;
}

export async function ensureUser(db: D1DatabaseLike, userId: string, now = new Date().toISOString()): Promise<UserRecord> {
  const existing = await getUser(db, userId);
  if (existing) return existing;
  await db
    .prepare("INSERT INTO users (id, created_at, updated_at) VALUES (?, ?, ?)")
    .bind(userId, now, now)
    .run();
  const created = await getUser(db, userId);
  if (!created) throw new Error("Failed to create user.");
  return created;
}

export async function getHostedSyncSettings(db: D1DatabaseLike, userId: string): Promise<HostedSyncSettings> {
  const row = await db
    .prepare(`SELECT scope, history_mode, watched_enabled, rating_sync_enabled, library_watchlist_enabled,
      removals_enabled, like_threshold, love_threshold, sync_interval_minutes, optional_catalogs_enabled
      FROM sync_settings WHERE user_id = ?`)
    .bind(userId)
    .first<Record<string, unknown>>();
  return row ? parseHostedSyncSettings(row) : defaultHostedSyncSettings();
}

export async function upsertHostedSyncSettings(
  db: D1DatabaseLike,
  userId: string,
  settings: HostedSyncSettings
): Promise<HostedSyncSettings> {
  await db
    .prepare(`INSERT INTO sync_settings (
      user_id, scope, history_mode, watched_enabled, rating_sync_enabled, library_watchlist_enabled,
      removals_enabled, like_threshold, love_threshold, sync_interval_minutes, optional_catalogs_enabled
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      scope = excluded.scope,
      history_mode = excluded.history_mode,
      watched_enabled = excluded.watched_enabled,
      rating_sync_enabled = excluded.rating_sync_enabled,
      library_watchlist_enabled = excluded.library_watchlist_enabled,
      removals_enabled = excluded.removals_enabled,
      like_threshold = excluded.like_threshold,
      love_threshold = excluded.love_threshold,
      sync_interval_minutes = excluded.sync_interval_minutes,
      optional_catalogs_enabled = excluded.optional_catalogs_enabled`)
    .bind(
      userId,
      settings.scope,
      settings.historyMode,
      boolInt(settings.watchedEnabled),
      boolInt(settings.ratingSyncEnabled),
      boolInt(settings.libraryWatchlistEnabled),
      boolInt(settings.removalsEnabled),
      settings.likeThreshold,
      settings.loveThreshold,
      settings.syncIntervalMinutes,
      boolInt(settings.optionalCatalogsEnabled)
    )
    .run();
  return getHostedSyncSettings(db, userId);
}

function parseUser(row: Record<string, unknown>): UserRecord {
  return {
    id: requiredString(row.id, "users.id"),
    createdAt: requiredString(row.created_at, "users.created_at"),
    updatedAt: requiredString(row.updated_at, "users.updated_at"),
    disabledAt: nullableString(row.disabled_at, "users.disabled_at")
  };
}

function parseHostedSyncSettings(row: Record<string, unknown>): HostedSyncSettings {
  const scope = requiredString(row.scope, "sync_settings.scope");
  if (scope !== "test" && scope !== "account-preview" && scope !== "account") {
    throw new Error("Unsupported sync settings scope.");
  }
  const historyMode = requiredString(row.history_mode, "sync_settings.history_mode");
  if (historyMode !== "union") throw new Error("Unsupported history mode.");
  const likeThreshold = requiredInt(row.like_threshold, "sync_settings.like_threshold");
  const loveThreshold = requiredInt(row.love_threshold, "sync_settings.love_threshold");
  if (likeThreshold < 1 || likeThreshold > 10 || loveThreshold < 1 || loveThreshold > 10 || likeThreshold >= loveThreshold) {
    throw new Error("Invalid rating thresholds.");
  }

  return {
    scope,
    historyMode,
    watchedEnabled: intBool(row.watched_enabled, "sync_settings.watched_enabled"),
    ratingSyncEnabled: intBool(row.rating_sync_enabled, "sync_settings.rating_sync_enabled"),
    libraryWatchlistEnabled: intBool(row.library_watchlist_enabled, "sync_settings.library_watchlist_enabled"),
    removalsEnabled: intBool(row.removals_enabled, "sync_settings.removals_enabled"),
    likeThreshold,
    loveThreshold,
    syncIntervalMinutes: requiredInt(row.sync_interval_minutes, "sync_settings.sync_interval_minutes"),
    optionalCatalogsEnabled: intBool(row.optional_catalogs_enabled, "sync_settings.optional_catalogs_enabled")
  };
}

function boolInt(value: boolean): number {
  return value ? 1 : 0;
}

function intBool(value: unknown, label: string): boolean {
  const parsed = requiredInt(value, label);
  if (parsed === 0) return false;
  if (parsed === 1) return true;
  throw new Error(`${label} must be 0 or 1.`);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`${label} must be a non-empty string.`);
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  throw new Error(`${label} must be a string or null.`);
}

function requiredInt(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  throw new Error(`${label} must be an integer.`);
}
