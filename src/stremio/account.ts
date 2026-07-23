const DEFAULT_STREMIO_API_BASE = "https://api.strem.io";
const TRAKT_TOKEN_SAFETY_MARGIN_MS = 5 * 60 * 1000;

// This is Stremio's public OAuth client identifier, not a client secret.
export const DEFAULT_STREMIO_TRAKT_CLIENT_ID =
  "0e861f52c7365efe6da5ea3e2e6641b8d25d87aca3133e8d4f7dc8487368d14b";

export interface StremioIdentity {
  userId: string;
}

export interface StremioTraktAuthorization extends StremioIdentity {
  accessToken: string;
  expiresAt: string;
}

export class StremioApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function loginToStremio(
  email: string,
  password: string,
  fetcher: typeof fetch,
  apiBase = DEFAULT_STREMIO_API_BASE
): Promise<string> {
  const result = await stremioRequest("login", { email, password }, fetcher, apiBase);
  return requiredString(result.authKey, "login authKey");
}

export async function fetchStremioIdentity(
  authKey: string,
  fetcher: typeof fetch,
  apiBase = DEFAULT_STREMIO_API_BASE
): Promise<StremioIdentity> {
  const result = await stremioRequest("getUser", { authKey }, fetcher, apiBase);
  return { userId: requiredString(result._id, "user _id") };
}

export async function fetchStremioTraktAuthorization(
  authKey: string,
  fetcher: typeof fetch,
  apiBase = DEFAULT_STREMIO_API_BASE,
  now = Date.now()
): Promise<StremioTraktAuthorization> {
  const result = await stremioRequest("getUser", { authKey }, fetcher, apiBase);
  const trakt = recordValue(result.trakt, "Stremio user Trakt authorization");
  const expiresAtSeconds = trakt.expires_at === undefined
    ? positiveNumber(trakt.created_at, "Trakt created_at") +
      positiveNumber(trakt.expires_in, "Trakt expires_in")
    : positiveNumber(trakt.expires_at, "Trakt expires_at");
  const expiresAtMs = expiresAtSeconds * 1000;
  if (!Number.isSafeInteger(expiresAtMs)) throw new Error("Stremio Trakt expiry is invalid.");
  if (expiresAtMs <= now + TRAKT_TOKEN_SAFETY_MARGIN_MS) {
    throw new Error("Stremio Trakt authorization is expired or too close to expiry. Reconnect Trakt in Stremio.");
  }
  return {
    userId: requiredString(result._id, "user _id"),
    accessToken: requiredString(trakt.access_token, "Trakt access_token"),
    expiresAt: new Date(expiresAtMs).toISOString()
  };
}

async function stremioRequest(
  method: string,
  body: Record<string, unknown>,
  fetcher: typeof fetch,
  apiBase: string
): Promise<Record<string, unknown>> {
  const response = await fetcher(`${apiBase.replace(/\/$/, "")}/api/${method}`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new StremioApiError(`Stremio ${method} failed with HTTP ${response.status}.`, response.status);
  const payload = recordValue(await response.json(), `Stremio ${method} response`);
  if (payload.error) throw new StremioApiError(`Stremio ${method} rejected the request.`, 400);
  return recordValue(payload.result, `Stremio ${method} result`);
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new Error(`${label} must be an object.`);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`Stremio ${label} must be a non-empty string.`);
}

function positiveNumber(value: unknown, label: string): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  throw new Error(`Stremio ${label} must be a positive number.`);
}
