const DEFAULT_TRAKT_API_BASE = "https://api.trakt.tv";

export interface TraktDeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  interval: number;
}

export interface TraktOAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  createdAt: number;
}

export interface TraktIdentity {
  username: string;
}

export type TraktPollResult =
  | { kind: "authorized"; tokens: TraktOAuthTokens }
  | { kind: "pending" }
  | { kind: "invalid" | "used" | "expired" | "denied" | "slow-down" };

export class TraktApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function startTraktDeviceAuthorization(
  clientId: string,
  fetcher: typeof fetch,
  apiBase = DEFAULT_TRAKT_API_BASE
): Promise<TraktDeviceAuthorization> {
  const response = await fetcher(`${normalizedBase(apiBase)}/oauth/device/code`, {
    method: "POST",
    headers: traktHeaders(clientId),
    body: JSON.stringify({ client_id: clientId })
  });
  if (!response.ok) throw new TraktApiError(`Trakt device authorization failed with HTTP ${response.status}.`, response.status);
  const body = recordValue(await response.json(), "Trakt device authorization response");
  return {
    deviceCode: requiredString(body.device_code, "device_code"),
    userCode: requiredString(body.user_code, "user_code"),
    verificationUrl: validHttpUrl(body.verification_url, "verification_url"),
    expiresIn: positiveInt(body.expires_in, "expires_in"),
    interval: positiveInt(body.interval, "interval")
  };
}

export async function pollTraktDeviceAuthorization(
  clientId: string,
  clientSecret: string,
  deviceCode: string,
  fetcher: typeof fetch,
  apiBase = DEFAULT_TRAKT_API_BASE
): Promise<TraktPollResult> {
  const response = await fetcher(`${normalizedBase(apiBase)}/oauth/device/token`, {
    method: "POST",
    headers: traktHeaders(clientId),
    body: JSON.stringify({ code: deviceCode, client_id: clientId, client_secret: clientSecret })
  });

  if (response.status === 400) return { kind: "pending" };
  if (response.status === 404) return { kind: "invalid" };
  if (response.status === 409) return { kind: "used" };
  if (response.status === 410) return { kind: "expired" };
  if (response.status === 418) return { kind: "denied" };
  if (response.status === 429) return { kind: "slow-down" };
  if (!response.ok) throw new TraktApiError(`Trakt device token request failed with HTTP ${response.status}.`, response.status);

  const body = recordValue(await response.json(), "Trakt token response");
  return {
    kind: "authorized",
    tokens: {
      accessToken: requiredString(body.access_token, "access_token"),
      refreshToken: requiredString(body.refresh_token, "refresh_token"),
      expiresIn: positiveInt(body.expires_in, "expires_in"),
      createdAt: positiveInt(body.created_at, "created_at")
    }
  };
}

export async function fetchTraktIdentity(
  clientId: string,
  accessToken: string,
  fetcher: typeof fetch,
  apiBase = DEFAULT_TRAKT_API_BASE
): Promise<TraktIdentity> {
  const response = await fetcher(`${normalizedBase(apiBase)}/users/settings`, {
    headers: {
      ...traktHeaders(clientId),
      authorization: `Bearer ${accessToken}`
    }
  });
  if (!response.ok) throw new TraktApiError(`Trakt account verification failed with HTTP ${response.status}.`, response.status);
  const body = recordValue(await response.json(), "Trakt settings response");
  const user = recordValue(body.user, "Trakt settings user");
  return { username: requiredString(user.username, "user.username") };
}

export async function refreshTraktToken(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  refreshToken: string,
  fetcher: typeof fetch,
  apiBase = DEFAULT_TRAKT_API_BASE
): Promise<TraktOAuthTokens> {
  const response = await fetcher(`${normalizedBase(apiBase)}/oauth/token`, {
    method: "POST",
    headers: traktHeaders(clientId),
    body: JSON.stringify({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "refresh_token"
    })
  });
  if (!response.ok) throw new TraktApiError(`Trakt token refresh failed with HTTP ${response.status}.`, response.status);
  return parseTokens(await response.json());
}

function traktHeaders(clientId: string): HeadersInit {
  return {
    accept: "application/json",
    "content-type": "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": clientId,
    "user-agent": "SYNCIO/0.1.0 self-hosted"
  };
}

function normalizedBase(value: string): string {
  return value.replace(/\/$/, "");
}

function parseTokens(value: unknown): TraktOAuthTokens {
  const body = recordValue(value, "Trakt token response");
  return {
    accessToken: requiredString(body.access_token, "access_token"),
    refreshToken: requiredString(body.refresh_token, "refresh_token"),
    expiresIn: positiveInt(body.expires_in, "expires_in"),
    createdAt: positiveInt(body.created_at, "created_at")
  };
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new Error(`${label} must be an object.`);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`Trakt ${label} must be a non-empty string.`);
}

function positiveInt(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  throw new Error(`Trakt ${label} must be a positive integer.`);
}

function validHttpUrl(value: unknown, label: string): string {
  const parsed = new URL(requiredString(value, label));
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error(`Trakt ${label} is invalid.`);
  return parsed.toString();
}
