import { requestJson } from "./http.js";
import { env, ProbeAbort, requireEnv } from "./probe.js";

export interface TraktPage {
  page: number;
  headers: Record<string, string>;
  body: unknown;
  shape: unknown;
}

export interface TraktAccountSummary {
  username?: string;
  slug?: string;
  name?: string;
  private?: boolean;
  vip?: boolean;
  joinedAt?: string;
}

let accountGuard: Promise<void> | undefined;

export async function traktRequest(path: string): Promise<TraktPage> {
  await assertTraktAccountGuard(path);

  const response = await requestJson(buildTraktUrl(path), {
    method: "GET",
    headers: traktHeaders()
  });

  if (!response.ok) {
    throw new ProbeAbort("FAIL", `Trakt ${path} failed with HTTP ${response.status}.`);
  }

  return {
    page: Number(response.headers["x-pagination-page"] ?? 1),
    headers: response.headers,
    body: response.body,
    shape: response.shape
  };
}

export async function traktPost(path: string, body: unknown): Promise<unknown> {
  await assertTraktAccountGuard(path);

  const response = await requestJson(buildTraktUrl(path), {
    method: "POST",
    headers: traktHeaders(),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new ProbeAbort("FAIL", `Trakt ${path} failed with HTTP ${response.status}.`);
  }

  return response.body;
}

export async function traktPaginated(
  endpoint: string,
  limit: number,
  maxPages: number
): Promise<TraktPage[]> {
  if (limit < 1 || limit > 250) {
    throw new ProbeAbort("FAIL", "Trakt limit must be between 1 and 250.");
  }

  const pages: TraktPage[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const separator = endpoint.includes("?") ? "&" : "?";
    const result = await traktRequest(`${endpoint}${separator}page=${page}&limit=${limit}`);
    pages.push(result);

    const pageCount = Number(result.headers["x-pagination-page-count"] ?? page);
    if (page >= pageCount) break;
  }
  return pages;
}

export async function readTraktAccountSummary(): Promise<TraktAccountSummary> {
  const response = await requestJson(buildTraktUrl("/users/settings"), {
    method: "GET",
    headers: traktHeaders()
  });

  if (!response.ok) {
    throw new ProbeAbort("FAIL", `Trakt /users/settings failed with HTTP ${response.status}.`);
  }

  return summarizeTraktSettings(response.body);
}

export function summarizeTraktSettings(value: unknown): TraktAccountSummary {
  if (!value || typeof value !== "object") {
    throw new ProbeAbort("FAIL", "Trakt settings response was not an object.");
  }

  const user = (value as Record<string, unknown>).user;
  if (!user || typeof user !== "object") {
    throw new ProbeAbort("FAIL", "Trakt settings response did not include a user object.");
  }

  const record = user as Record<string, unknown>;
  const ids = record.ids && typeof record.ids === "object"
    ? record.ids as Record<string, unknown>
    : {};
  const summary: TraktAccountSummary = {};
  assignIfDefined(summary, "username", stringValue(record.username));
  assignIfDefined(summary, "slug", stringValue(ids.slug));
  assignIfDefined(summary, "name", stringValue(record.name));
  assignIfDefined(summary, "private", booleanValue(record.private));
  assignIfDefined(summary, "vip", booleanValue(record.vip));
  assignIfDefined(summary, "joinedAt", stringValue(record.joined_at));
  return summary;
}

function buildTraktUrl(path: string): string {
  const base = env("TRAKT_API_BASE") ?? "https://api.trakt.tv";
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

function traktHeaders(): HeadersInit {
  return {
    "content-type": "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": requireEnv("TRAKT_CLIENT_ID"),
    "authorization": `Bearer ${requireEnv("TRAKT_ACCESS_TOKEN")}`,
    "user-agent": env("SYNCIO_USER_AGENT") ?? "SYNCIO/0.0.0 research"
  };
}

async function assertTraktAccountGuard(path: string): Promise<void> {
  const expectedUsername = env("TRAKT_EXPECTED_USERNAME");
  if (!expectedUsername || path === "/users/settings") return;

  accountGuard ??= (async () => {
    const summary = await readTraktAccountSummary();
    if (summary.username !== expectedUsername) {
      throw new ProbeAbort(
        "FAIL",
        `Trakt account guard failed: expected ${expectedUsername}, got ${summary.username ?? "unknown"}.`
      );
    }
  })();
  await accountGuard;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function assignIfDefined<Key extends keyof TraktAccountSummary>(
  target: TraktAccountSummary,
  key: Key,
  value: TraktAccountSummary[Key] | undefined
): void {
  if (value !== undefined) target[key] = value;
}
