import type { D1DatabaseLike } from "../d1";

export type TraktAuthMode = "direct-oauth" | "stremio-delegated";

export interface ConnectionRecord {
  userId: string;
  stremioAuthCiphertext: string | null;
  stremioUserId: string | null;
  traktAuthMode: TraktAuthMode;
  traktClientIdCiphertext: string | null;
  traktClientSecretCiphertext: string | null;
  traktRedirectUri: string | null;
  traktAccessCiphertext: string | null;
  traktRefreshCiphertext: string | null;
  traktExpiresAt: string | null;
  traktUsername: string | null;
  encryptionVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionUpsert {
  stremioAuthCiphertext?: string | null;
  stremioUserId?: string | null;
  traktAuthMode?: TraktAuthMode;
  traktClientIdCiphertext?: string | null;
  traktClientSecretCiphertext?: string | null;
  traktRedirectUri?: string | null;
  traktAccessCiphertext?: string | null;
  traktRefreshCiphertext?: string | null;
  traktExpiresAt?: string | null;
  traktUsername?: string | null;
  encryptionVersion: number;
}

export async function getConnection(db: D1DatabaseLike, userId: string): Promise<ConnectionRecord | null> {
  const row = await db
    .prepare(`SELECT user_id, stremio_auth_ciphertext, stremio_user_id,
      trakt_auth_mode,
      trakt_client_id_ciphertext, trakt_client_secret_ciphertext, trakt_redirect_uri,
      trakt_access_ciphertext, trakt_refresh_ciphertext, trakt_expires_at, trakt_username,
      encryption_version, created_at, updated_at
      FROM connections WHERE user_id = ?`)
    .bind(userId)
    .first<Record<string, unknown>>();
  return row ? parseConnection(row) : null;
}

export async function upsertConnection(
  db: D1DatabaseLike,
  userId: string,
  input: ConnectionUpsert,
  now = new Date().toISOString()
): Promise<ConnectionRecord> {
  const existing = await getConnection(db, userId);
  const next = {
    stremioAuthCiphertext: resolveField(input, "stremioAuthCiphertext", existing?.stremioAuthCiphertext),
    stremioUserId: resolveField(input, "stremioUserId", existing?.stremioUserId),
    traktAuthMode: input.traktAuthMode ?? existing?.traktAuthMode ?? "direct-oauth",
    traktClientIdCiphertext: resolveField(input, "traktClientIdCiphertext", existing?.traktClientIdCiphertext),
    traktClientSecretCiphertext: resolveField(input, "traktClientSecretCiphertext", existing?.traktClientSecretCiphertext),
    traktRedirectUri: resolveField(input, "traktRedirectUri", existing?.traktRedirectUri),
    traktAccessCiphertext: resolveField(input, "traktAccessCiphertext", existing?.traktAccessCiphertext),
    traktRefreshCiphertext: resolveField(input, "traktRefreshCiphertext", existing?.traktRefreshCiphertext),
    traktExpiresAt: resolveField(input, "traktExpiresAt", existing?.traktExpiresAt),
    traktUsername: resolveField(input, "traktUsername", existing?.traktUsername),
    encryptionVersion: input.encryptionVersion
  };

  await db
    .prepare(`INSERT INTO connections (
      user_id, stremio_auth_ciphertext, stremio_user_id, trakt_auth_mode,
      trakt_client_id_ciphertext, trakt_client_secret_ciphertext,
      trakt_redirect_uri,
      trakt_access_ciphertext, trakt_refresh_ciphertext, trakt_expires_at, trakt_username,
      encryption_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      stremio_auth_ciphertext = excluded.stremio_auth_ciphertext,
      stremio_user_id = excluded.stremio_user_id,
      trakt_auth_mode = excluded.trakt_auth_mode,
      trakt_client_id_ciphertext = excluded.trakt_client_id_ciphertext,
      trakt_client_secret_ciphertext = excluded.trakt_client_secret_ciphertext,
      trakt_redirect_uri = excluded.trakt_redirect_uri,
      trakt_access_ciphertext = excluded.trakt_access_ciphertext,
      trakt_refresh_ciphertext = excluded.trakt_refresh_ciphertext,
      trakt_expires_at = excluded.trakt_expires_at,
      trakt_username = excluded.trakt_username,
      encryption_version = excluded.encryption_version,
      updated_at = excluded.updated_at`)
    .bind(
      userId,
      next.stremioAuthCiphertext,
      next.stremioUserId,
      next.traktAuthMode,
      next.traktClientIdCiphertext,
      next.traktClientSecretCiphertext,
      next.traktRedirectUri,
      next.traktAccessCiphertext,
      next.traktRefreshCiphertext,
      next.traktExpiresAt,
      next.traktUsername,
      next.encryptionVersion,
      existing?.createdAt ?? now,
      now
    )
    .run();

  const saved = await getConnection(db, userId);
  if (!saved) throw new Error("Failed to save connection.");
  return saved;
}

function parseConnection(row: Record<string, unknown>): ConnectionRecord {
  return {
    userId: requiredString(row.user_id, "connections.user_id"),
    stremioAuthCiphertext: nullableString(row.stremio_auth_ciphertext, "connections.stremio_auth_ciphertext"),
    stremioUserId: nullableString(row.stremio_user_id, "connections.stremio_user_id"),
    traktAuthMode: parseTraktAuthMode(row.trakt_auth_mode),
    traktClientIdCiphertext: nullableString(row.trakt_client_id_ciphertext, "connections.trakt_client_id_ciphertext"),
    traktClientSecretCiphertext: nullableString(row.trakt_client_secret_ciphertext, "connections.trakt_client_secret_ciphertext"),
    traktRedirectUri: nullableString(row.trakt_redirect_uri, "connections.trakt_redirect_uri"),
    traktAccessCiphertext: nullableString(row.trakt_access_ciphertext, "connections.trakt_access_ciphertext"),
    traktRefreshCiphertext: nullableString(row.trakt_refresh_ciphertext, "connections.trakt_refresh_ciphertext"),
    traktExpiresAt: nullableString(row.trakt_expires_at, "connections.trakt_expires_at"),
    traktUsername: nullableString(row.trakt_username, "connections.trakt_username"),
    encryptionVersion: requiredInt(row.encryption_version, "connections.encryption_version"),
    createdAt: requiredString(row.created_at, "connections.created_at"),
    updatedAt: requiredString(row.updated_at, "connections.updated_at")
  };
}

type ConnectionStringField = Exclude<keyof ConnectionUpsert, "encryptionVersion" | "traktAuthMode">;

function resolveField(
  input: ConnectionUpsert,
  key: ConnectionStringField,
  existing: string | null | undefined
): string | null {
  if (Object.prototype.hasOwnProperty.call(input, key)) {
    const value = input[key];
    if (typeof value === "string") return value;
    return null;
  }
  return existing ?? null;
}

function parseTraktAuthMode(value: unknown): TraktAuthMode {
  if (value === "direct-oauth" || value === "stremio-delegated") return value;
  throw new Error("connections.trakt_auth_mode is invalid.");
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
