import type { D1DatabaseLike } from "../d1";

export interface TraktDeviceSession {
  userId: string;
  deviceCodeCiphertext: string;
  userCode: string;
  verificationUrl: string;
  expiresAt: string;
  intervalSeconds: number;
  nextPollAt: string;
  createdAt: string;
  updatedAt: string;
}

export type TraktDeviceSessionInput = Omit<TraktDeviceSession, "userId" | "createdAt" | "updatedAt">;

export async function getTraktDeviceSession(
  db: D1DatabaseLike,
  userId: string
): Promise<TraktDeviceSession | null> {
  const row = await db
    .prepare(`SELECT user_id, device_code_ciphertext, user_code, verification_url, expires_at,
      interval_seconds, next_poll_at, created_at, updated_at
      FROM trakt_device_sessions WHERE user_id = ?`)
    .bind(userId)
    .first<Record<string, unknown>>();
  return row ? parseSession(row) : null;
}

export async function upsertTraktDeviceSession(
  db: D1DatabaseLike,
  userId: string,
  input: TraktDeviceSessionInput,
  now = new Date().toISOString()
): Promise<TraktDeviceSession> {
  const existing = await getTraktDeviceSession(db, userId);
  await db
    .prepare(`INSERT INTO trakt_device_sessions (
      user_id, device_code_ciphertext, user_code, verification_url, expires_at,
      interval_seconds, next_poll_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      device_code_ciphertext = excluded.device_code_ciphertext,
      user_code = excluded.user_code,
      verification_url = excluded.verification_url,
      expires_at = excluded.expires_at,
      interval_seconds = excluded.interval_seconds,
      next_poll_at = excluded.next_poll_at,
      updated_at = excluded.updated_at`)
    .bind(
      userId,
      input.deviceCodeCiphertext,
      input.userCode,
      input.verificationUrl,
      input.expiresAt,
      input.intervalSeconds,
      input.nextPollAt,
      existing?.createdAt ?? now,
      now
    )
    .run();
  const saved = await getTraktDeviceSession(db, userId);
  if (!saved) throw new Error("Failed to save Trakt device session.");
  return saved;
}

export async function deleteTraktDeviceSession(db: D1DatabaseLike, userId: string): Promise<void> {
  await db.prepare("DELETE FROM trakt_device_sessions WHERE user_id = ?").bind(userId).run();
}

function parseSession(row: Record<string, unknown>): TraktDeviceSession {
  return {
    userId: requiredString(row.user_id, "trakt_device_sessions.user_id"),
    deviceCodeCiphertext: requiredString(row.device_code_ciphertext, "trakt_device_sessions.device_code_ciphertext"),
    userCode: requiredString(row.user_code, "trakt_device_sessions.user_code"),
    verificationUrl: requiredString(row.verification_url, "trakt_device_sessions.verification_url"),
    expiresAt: requiredString(row.expires_at, "trakt_device_sessions.expires_at"),
    intervalSeconds: requiredInt(row.interval_seconds, "trakt_device_sessions.interval_seconds"),
    nextPollAt: requiredString(row.next_poll_at, "trakt_device_sessions.next_poll_at"),
    createdAt: requiredString(row.created_at, "trakt_device_sessions.created_at"),
    updatedAt: requiredString(row.updated_at, "trakt_device_sessions.updated_at")
  };
}

function requiredString(value: unknown, label: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`${label} must be a non-empty string.`);
}

function requiredInt(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  throw new Error(`${label} must be an integer.`);
}
