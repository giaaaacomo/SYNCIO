import { requestJson } from "./http.js";
import { env, ProbeAbort } from "./probe.js";

export type StremioMediaType = "movie" | "series";
export type StremioRatingStatus = "watched" | "liked" | "loved" | null;

export interface StremioLibraryState {
  lastWatched?: string;
  timeWatched?: number;
  timeOffset?: number;
  overallTimeWatched?: number;
  timesWatched?: number;
  flaggedWatched?: number;
  duration?: number;
  video_id?: string;
  watched?: string | null;
  noNotif?: boolean;
  [key: string]: unknown;
}

export interface StremioLibraryItem {
  _id: string;
  _ctime?: string;
  _mtime?: string;
  name?: string;
  type?: string;
  poster?: string;
  posterShape?: string;
  removed?: boolean;
  temp?: boolean;
  state?: StremioLibraryState;
  behaviorHints?: Record<string, unknown>;
  year?: number;
  [key: string]: unknown;
}

export interface StremioApiCallResult {
  result: unknown;
  responseShape: unknown;
}

export interface StremioUser {
  _id: string;
  email?: string;
  trakt?: unknown;
  [key: string]: unknown;
}

export async function resolveStremioAuthKey(): Promise<string> {
  const authKey = env("STREMIO_AUTH_KEY");
  if (authKey) {
    await assertStremioAuthMatchesExpectedUser(authKey);
    return authKey;
  }

  const email = env("STREMIO_EMAIL");
  const password = env("STREMIO_PASSWORD");
  if (!email || !password) {
    throw new ProbeAbort(
      "FAIL",
      "Set STREMIO_AUTH_KEY or both STREMIO_EMAIL and STREMIO_PASSWORD."
    );
  }

  const result = await stremioApiRequest("login", { email, password });
  const body = asRecord(result.result);
  const acquiredAuthKey = body.authKey;
  if (typeof acquiredAuthKey !== "string" || acquiredAuthKey.length === 0) {
    throw new ProbeAbort("FAIL", "Stremio login response did not include authKey.");
  }
  await assertStremioAuthMatchesExpectedUser(acquiredAuthKey);
  return acquiredAuthKey;
}

export async function stremioApiRequest(
  method: string,
  params: Record<string, unknown>,
  authKey?: string
): Promise<StremioApiCallResult> {
  const endpoint = env("STREMIO_API_BASE") ?? "https://api.strem.io";
  const body = authKey ? { authKey, ...params } : params;
  const response = await requestJson(`${endpoint}/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new ProbeAbort("FAIL", `Stremio ${method} failed with HTTP ${response.status}.`);
  }

  const payload = asRecord(response.body);
  if (payload.error) {
    throw new ProbeAbort("FAIL", `Stremio ${method} returned error: ${String(payload.error)}`);
  }
  if (!("result" in payload)) {
    throw new ProbeAbort("FAIL", `Stremio ${method} response did not include result.`);
  }

  return { result: payload.result, responseShape: response.shape };
}

export async function getStremioUser(authKey: string): Promise<StremioUser> {
  const user = (await stremioApiRequest("getUser", {}, authKey)).result;
  return parseStremioUser(user);
}

export async function getLibraryItems(authKey: string): Promise<StremioLibraryItem[]> {
  const result = (await stremioApiRequest(
    "datastoreGet",
    { collection: "libraryItem", all: true },
    authKey
  )).result;

  if (!Array.isArray(result)) {
    throw new ProbeAbort("FAIL", "Stremio datastoreGet libraryItem did not return an array.");
  }

  return result.filter(isLibraryItem);
}

export async function putLibraryChanges(
  authKey: string,
  changes: StremioLibraryItem[]
): Promise<unknown> {
  return (await stremioApiRequest(
    "datastorePut",
    { collection: "libraryItem", changes },
    authKey
  )).result;
}

export async function getRatingStatus(
  authKey: string,
  mediaId: string,
  mediaType: StremioMediaType
): Promise<unknown> {
  const base = env("STREMIO_LIKES_BASE") ?? "https://likes.stremio.com/api";
  const url = new URL(`${base}/get_status`);
  url.searchParams.set("authToken", authKey);
  url.searchParams.set("mediaId", mediaId);
  url.searchParams.set("mediaType", mediaType);

  const response = await requestJson(url.toString(), { method: "GET" });
  if (!response.ok) {
    throw new ProbeAbort("FAIL", `Stremio rating get failed with HTTP ${response.status}.`);
  }
  return response.body;
}

export async function sendRatingStatus(
  authKey: string,
  mediaId: string,
  mediaType: StremioMediaType,
  status: StremioRatingStatus
): Promise<unknown> {
  const base = env("STREMIO_LIKES_BASE") ?? "https://likes.stremio.com/api";
  const response = await requestJson(`${base}/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ authToken: authKey, mediaId, mediaType, status })
  });
  if (!response.ok) {
    throw new ProbeAbort("FAIL", `Stremio rating send failed with HTTP ${response.status}.`);
  }
  return response.body;
}

export function parseMediaType(value: string): StremioMediaType {
  if (value === "movie" || value === "series") return value;
  throw new ProbeAbort("FAIL", "media-type must be movie or series.");
}

export function parseRatingStatus(value: string): StremioRatingStatus {
  if (value === "null" || value === "none") return null;
  if (value === "watched" || value === "liked" || value === "loved") return value;
  throw new ProbeAbort("FAIL", "status must be watched, liked, loved, or null.");
}

export async function assertStremioAuthMatchesExpectedUser(authKey: string): Promise<void> {
  const expectedUserId = env("STREMIO_EXPECTED_USER_ID");
  if (!expectedUserId) return;

  const user = parseStremioUser((await stremioApiRequest("getUser", {}, authKey)).result);
  if (user._id !== expectedUserId) {
    throw new ProbeAbort(
      "FAIL",
      "Stremio account guard failed: auth key belongs to a different user than STREMIO_EXPECTED_USER_ID."
    );
  }
}

export function summarizeStremioUser(user: StremioUser): Record<string, unknown> {
  return {
    userId: `${user._id.slice(0, 4)}...[redacted]...${user._id.slice(-4)}`,
    emailDomain: typeof user.email === "string" ? user.email.replace(/^[^@]+/, "[redacted]") : undefined,
    traktLinked: Boolean(user.trakt)
  };
}

function isLibraryItem(value: unknown): value is StremioLibraryItem {
  return Boolean(value && typeof value === "object" && typeof (value as { _id?: unknown })._id === "string");
}

function parseStremioUser(value: unknown): StremioUser {
  const record = asRecord(value);
  if (typeof record._id !== "string" || record._id.length === 0) {
    throw new ProbeAbort("FAIL", "Stremio getUser response did not include a user _id.");
  }
  return record as StremioUser;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new ProbeAbort("FAIL", "Expected an object response.");
  }
  return value as Record<string, unknown>;
}
