import type { D1DatabaseLike, D1ResultLike } from "../d1.js";

export const COMPANION_SCOPES = [
  "status:read",
  "history:preview",
  "history:submit",
  "scrobble:write"
] as const;

export type CompanionScope = (typeof COMPANION_SCOPES)[number];

export const DEFAULT_COMPANION_SCOPES: CompanionScope[] = [
  "status:read",
  "history:preview"
];

export interface CompanionClient {
  id: string;
  userId: string;
  tokenHash: string;
  label: string;
  scopes: CompanionScope[];
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

export async function upsertCompanionPairingSession(
  db: D1DatabaseLike,
  userId: string,
  codeHash: string,
  expiresAt: string,
  createdAt = new Date().toISOString()
): Promise<void> {
  await db.prepare(`INSERT INTO companion_pairing_sessions (
      user_id, code_hash, expires_at, created_at
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      code_hash = excluded.code_hash,
      expires_at = excluded.expires_at,
      created_at = excluded.created_at`)
    .bind(userId, codeHash, expiresAt, createdAt)
    .run();
}

export async function consumeCompanionPairingSession(
  db: D1DatabaseLike,
  userId: string,
  codeHash: string,
  now = new Date().toISOString()
): Promise<boolean> {
  const result = await db.prepare(`DELETE FROM companion_pairing_sessions
    WHERE user_id = ? AND code_hash = ? AND expires_at > ?`)
    .bind(userId, codeHash, now)
    .run();
  return changedRows(result) === 1;
}

export async function createCompanionClient(
  db: D1DatabaseLike,
  input: {
    id: string;
    userId: string;
    tokenHash: string;
    label: string;
    scopes?: CompanionScope[];
  },
  now = new Date().toISOString()
): Promise<CompanionClient> {
  const scopes = input.scopes ?? [...DEFAULT_COMPANION_SCOPES];
  await db.prepare(`INSERT INTO companion_clients (
      id, user_id, token_hash, label, scopes_json, created_at, last_seen_at, revoked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`)
    .bind(
      input.id,
      input.userId,
      input.tokenHash,
      input.label,
      JSON.stringify(scopes),
      now,
      now
    )
    .run();
  return {
    id: input.id,
    userId: input.userId,
    tokenHash: input.tokenHash,
    label: input.label,
    scopes,
    createdAt: now,
    lastSeenAt: now,
    revokedAt: null
  };
}

export async function getActiveCompanionClientByTokenHash(
  db: D1DatabaseLike,
  tokenHash: string
): Promise<CompanionClient | null> {
  const row = await db.prepare(`SELECT
      id, user_id, token_hash, label, scopes_json, created_at, last_seen_at, revoked_at
    FROM companion_clients
    WHERE token_hash = ? AND revoked_at IS NULL`)
    .bind(tokenHash)
    .first<Record<string, unknown>>();
  return row ? parseClient(row) : null;
}

export async function touchCompanionClient(
  db: D1DatabaseLike,
  clientId: string,
  lastSeenAt = new Date().toISOString()
): Promise<void> {
  await db.prepare(`UPDATE companion_clients
    SET last_seen_at = ?
    WHERE id = ? AND revoked_at IS NULL`)
    .bind(lastSeenAt, clientId)
    .run();
}

export async function listCompanionClients(
  db: D1DatabaseLike,
  userId: string
): Promise<Array<Omit<CompanionClient, "tokenHash">>> {
  const row = await db.prepare(`SELECT COALESCE(json_group_array(json_object(
      'id', id,
      'user_id', user_id,
      'label', label,
      'scopes_json', scopes_json,
      'created_at', created_at,
      'last_seen_at', last_seen_at,
      'revoked_at', revoked_at
    )), '[]') AS clients
    FROM companion_clients
    WHERE user_id = ?`)
    .bind(userId)
    .first<{ clients?: unknown }>();
  const parsed = JSON.parse(typeof row?.clients === "string" ? row.clients : "[]") as unknown[];
  return parsed.map((value) => {
    const client = parseClient(recordValue(value, "companion client"), false);
    const { tokenHash: _tokenHash, ...safe } = client;
    return safe;
  });
}

export async function revokeCompanionClient(
  db: D1DatabaseLike,
  userId: string,
  clientId: string,
  revokedAt = new Date().toISOString()
): Promise<boolean> {
  const result = await db.prepare(`UPDATE companion_clients
    SET revoked_at = ?
    WHERE user_id = ? AND id = ? AND revoked_at IS NULL`)
    .bind(revokedAt, userId, clientId)
    .run();
  return changedRows(result) === 1;
}

function parseClient(row: Record<string, unknown>, requireToken = true): CompanionClient {
  const scopesValue = requiredString(row.scopes_json, "companion_clients.scopes_json");
  const parsedScopes = JSON.parse(scopesValue) as unknown;
  if (!Array.isArray(parsedScopes) || !parsedScopes.every(isCompanionScope)) {
    throw new Error("companion_clients.scopes_json is invalid.");
  }
  return {
    id: requiredString(row.id, "companion_clients.id"),
    userId: requiredString(row.user_id, "companion_clients.user_id"),
    tokenHash: requireToken
      ? requiredString(row.token_hash, "companion_clients.token_hash")
      : typeof row.token_hash === "string" ? row.token_hash : "",
    label: requiredString(row.label, "companion_clients.label"),
    scopes: parsedScopes,
    createdAt: requiredString(row.created_at, "companion_clients.created_at"),
    lastSeenAt: requiredString(row.last_seen_at, "companion_clients.last_seen_at"),
    revokedAt: nullableString(row.revoked_at, "companion_clients.revoked_at")
  };
}

function isCompanionScope(value: unknown): value is CompanionScope {
  return typeof value === "string" && COMPANION_SCOPES.includes(value as CompanionScope);
}

function changedRows(result: D1ResultLike): number {
  if (!result.meta || typeof result.meta !== "object") return 0;
  const changes = (result.meta as { changes?: unknown }).changes;
  return typeof changes === "number" && Number.isInteger(changes) ? changes : 0;
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a string.`);
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`${label} must be a string or null.`);
  return value;
}
