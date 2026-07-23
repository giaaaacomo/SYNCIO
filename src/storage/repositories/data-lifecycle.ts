import type { D1DatabaseLike } from "../d1.js";
import { getConnection } from "./connections.js";
import { getRecentSyncRuns } from "./sync-runs.js";
import { getTraktDeviceSession } from "./trakt-device-sessions.js";
import {
  getHostedSyncSettings,
  getLiveSyncActivation,
  getUser,
  upsertHostedSyncSettings
} from "./users.js";

export interface SyncioDataExport {
  format: "syncio-privacy-export";
  version: 1;
  exportedAt: string;
  user: {
    configured: boolean;
    createdAt: string | null;
    updatedAt: string | null;
  };
  connection: {
    stremioUserId: string | null;
    traktUsername: string | null;
    traktAuthMode: string | null;
    hasEncryptedStremioAuth: boolean;
    hasEncryptedDirectTraktApp: boolean;
    hasEncryptedDirectTraktTokens: boolean;
    pendingTraktDeviceLink: boolean;
    createdAt: string | null;
    updatedAt: string | null;
  };
  settings: Awaited<ReturnType<typeof getHostedSyncSettings>>;
  liveActivation: Awaited<ReturnType<typeof getLiveSyncActivation>>;
  recentRuns: Awaited<ReturnType<typeof getRecentSyncRuns>>;
  appliedChanges: AppliedChangeExport[];
  cursors: CursorExport[];
  conflicts: ConflictExport[];
  excludedSecrets: string[];
}

interface AppliedChangeExport {
  key: string;
  direction: string;
  kind: string;
  summary: string;
  firstAppliedAt: string;
  lastAppliedAt: string;
  appliedCount: number;
}

interface CursorExport {
  key: string;
  value: number;
  updatedAt: string;
}

interface ConflictExport {
  id: string;
  mediaKey: string;
  kind: string;
  status: string;
  payload: unknown;
  createdAt: string;
  resolvedAt: string | null;
}

export async function exportSyncioUserData(
  db: D1DatabaseLike,
  userId: string,
  exportedAt = new Date().toISOString()
): Promise<SyncioDataExport> {
  const [user, connection, settings, liveActivation, recentRuns, deviceSession, appliedChanges, cursors, conflicts] =
    await Promise.all([
      getUser(db, userId),
      getConnection(db, userId),
      getHostedSyncSettings(db, userId),
      getLiveSyncActivation(db, userId),
      getRecentSyncRuns(db, userId, 50),
      getTraktDeviceSession(db, userId),
      readAppliedChanges(db, userId),
      readCursors(db, userId),
      readConflicts(db, userId)
    ]);

  return {
    format: "syncio-privacy-export",
    version: 1,
    exportedAt,
    user: {
      configured: Boolean(user),
      createdAt: user?.createdAt ?? null,
      updatedAt: user?.updatedAt ?? null
    },
    connection: {
      stremioUserId: connection?.stremioUserId ?? null,
      traktUsername: connection?.traktUsername ?? null,
      traktAuthMode: connection?.traktAuthMode ?? null,
      hasEncryptedStremioAuth: Boolean(connection?.stremioAuthCiphertext),
      hasEncryptedDirectTraktApp: Boolean(
        connection?.traktClientIdCiphertext && connection.traktClientSecretCiphertext
      ),
      hasEncryptedDirectTraktTokens: Boolean(
        connection?.traktAccessCiphertext && connection.traktRefreshCiphertext
      ),
      pendingTraktDeviceLink: Boolean(deviceSession),
      createdAt: connection?.createdAt ?? null,
      updatedAt: connection?.updatedAt ?? null
    },
    settings,
    liveActivation,
    recentRuns,
    appliedChanges,
    cursors,
    conflicts,
    excludedSecrets: [
      "Stremio auth key",
      "Trakt client secret",
      "Trakt access token",
      "Trakt refresh token",
      "encrypted credential ciphertext"
    ]
  };
}

export async function disconnectSyncioAccounts(db: D1DatabaseLike, userId: string): Promise<void> {
  if (!(await getUser(db, userId))) return;
  const settings = await getHostedSyncSettings(db, userId);
  await upsertHostedSyncSettings(db, userId, {
    ...settings,
    scope: "account-preview"
  });
  await db.prepare("DELETE FROM trakt_device_sessions WHERE user_id = ?").bind(userId).run();
  await db.prepare("DELETE FROM connections WHERE user_id = ?").bind(userId).run();
}

export async function deleteSyncioUserData(db: D1DatabaseLike, userId: string): Promise<void> {
  const tables = [
    "trakt_device_sessions",
    "sync_cursors",
    "change_ledger",
    "sync_conflicts",
    "sync_runs",
    "connections",
    "sync_settings",
    "users"
  ];
  for (const table of tables) {
    const key = table === "users" ? "id" : "user_id";
    await db.prepare(`DELETE FROM ${table} WHERE ${key} = ?`).bind(userId).run();
  }
}

async function readAppliedChanges(db: D1DatabaseLike, userId: string): Promise<AppliedChangeExport[]> {
  const rows = await jsonRows(db, `SELECT COALESCE(json_group_array(json_object(
      'key', key,
      'direction', direction,
      'kind', kind,
      'summary', summary,
      'first_applied_at', first_applied_at,
      'last_applied_at', last_applied_at,
      'applied_count', applied_count
    )), '[]') AS rows
    FROM change_ledger WHERE user_id = ?`, userId, "change ledger");
  return rows.map((value, index) => {
    const row = recordValue(value, `change ledger[${index}]`);
    return {
      key: requiredString(row.key, "change_ledger.key"),
      direction: requiredString(row.direction, "change_ledger.direction"),
      kind: requiredString(row.kind, "change_ledger.kind"),
      summary: requiredString(row.summary, "change_ledger.summary"),
      firstAppliedAt: requiredString(row.first_applied_at, "change_ledger.first_applied_at"),
      lastAppliedAt: requiredString(row.last_applied_at, "change_ledger.last_applied_at"),
      appliedCount: requiredInt(row.applied_count, "change_ledger.applied_count")
    };
  });
}

async function readCursors(db: D1DatabaseLike, userId: string): Promise<CursorExport[]> {
  const rows = await jsonRows(db, `SELECT COALESCE(json_group_array(json_object(
      'cursor_key', cursor_key,
      'cursor_value', cursor_value,
      'updated_at', updated_at
    )), '[]') AS rows
    FROM sync_cursors WHERE user_id = ?`, userId, "sync cursors");
  return rows.map((value, index) => {
    const row = recordValue(value, `sync cursors[${index}]`);
    return {
      key: requiredString(row.cursor_key, "sync_cursors.cursor_key"),
      value: requiredInt(row.cursor_value, "sync_cursors.cursor_value"),
      updatedAt: requiredString(row.updated_at, "sync_cursors.updated_at")
    };
  });
}

async function readConflicts(db: D1DatabaseLike, userId: string): Promise<ConflictExport[]> {
  const rows = await jsonRows(db, `SELECT COALESCE(json_group_array(json_object(
      'id', id,
      'media_key', media_key,
      'kind', kind,
      'status', status,
      'payload_json', payload_json,
      'created_at', created_at,
      'resolved_at', resolved_at
    )), '[]') AS rows
    FROM sync_conflicts WHERE user_id = ?`, userId, "sync conflicts");
  return rows.map((value, index) => {
    const row = recordValue(value, `sync conflicts[${index}]`);
    return {
      id: requiredString(row.id, "sync_conflicts.id"),
      mediaKey: requiredString(row.media_key, "sync_conflicts.media_key"),
      kind: requiredString(row.kind, "sync_conflicts.kind"),
      status: requiredString(row.status, "sync_conflicts.status"),
      payload: parseJson(requiredString(row.payload_json, "sync_conflicts.payload_json"), "sync_conflicts.payload_json"),
      createdAt: requiredString(row.created_at, "sync_conflicts.created_at"),
      resolvedAt: nullableString(row.resolved_at, "sync_conflicts.resolved_at")
    };
  });
}

async function jsonRows(
  db: D1DatabaseLike,
  query: string,
  userId: string,
  label: string
): Promise<unknown[]> {
  const row = await db.prepare(query).bind(userId).first<{ rows?: unknown }>();
  if (row?.rows === undefined || row.rows === null) return [];
  const parsed = typeof row.rows === "string" ? parseJson(row.rows, label) : row.rows;
  if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array.`);
  return parsed;
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} must contain valid JSON.`);
  }
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error(`${label} must be an object.`);
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
