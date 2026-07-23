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
  state?: Record<string, unknown>;
  behaviorHints?: Record<string, unknown>;
}

export interface CinemetaVideoSet {
  id: string;
  name: string | null;
  videos: string[];
}

export type StremioRatingStatus = "watched" | "liked" | "loved" | null;

export interface TraktPaginatedResult {
  items: unknown[];
  pagesFetched: number;
  pageCount: number;
  itemCount: number;
}

export interface TraktPageResult {
  items: unknown[];
  page: number;
  pageCount: number;
  itemCount: number;
}

export async function stremioApiRequest(
  method: string,
  authKey: string,
  params: Record<string, unknown>,
  fetcher: typeof fetch,
  apiBase = "https://api.strem.io"
): Promise<unknown> {
  const response = await fetcher(`${apiBase.replace(/\/$/, "")}/api/${method}`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ authKey, ...params })
  });
  if (!response.ok) throw new Error(`Stremio ${method} failed with HTTP ${response.status}.`);
  const payload = recordValue(await response.json(), `Stremio ${method} response`);
  if (payload.error) throw new Error(`Stremio ${method} rejected the request.`);
  if (!("result" in payload)) throw new Error(`Stremio ${method} response has no result.`);
  return payload.result;
}

export async function getStremioLibrary(
  authKey: string,
  fetcher: typeof fetch,
  apiBase?: string
): Promise<StremioLibraryItem[]> {
  const result = await stremioApiRequest("datastoreGet", authKey, { collection: "libraryItem", all: true }, fetcher, apiBase);
  if (!Array.isArray(result)) throw new Error("Stremio library response must be an array.");
  return result.filter((value): value is StremioLibraryItem => Boolean(
    value && typeof value === "object" && typeof (value as { _id?: unknown })._id === "string"
  ));
}

export async function traktGet(
  path: string,
  clientId: string,
  accessToken: string,
  fetcher: typeof fetch,
  apiBase = "https://api.trakt.tv"
): Promise<unknown> {
  const response = await fetcher(`${apiBase.replace(/\/$/, "")}${path}`, {
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "trakt-api-version": "2",
      "trakt-api-key": clientId,
      authorization: `Bearer ${accessToken}`,
      "user-agent": "SYNCIO/0.1.0 self-hosted"
    }
  });
  if (!response.ok) throw new Error(`Trakt ${path} failed with HTTP ${response.status}.`);
  return response.json();
}

export async function traktGetAllPages(
  path: string,
  clientId: string,
  accessToken: string,
  fetcher: typeof fetch,
  apiBase = "https://api.trakt.tv",
  options: { limit?: number; maxPages?: number } = {}
): Promise<TraktPaginatedResult> {
  const limit = options.limit ?? 1000;
  const maxPages = options.maxPages ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(maxPages) || maxPages < 1) {
    throw new Error("Invalid Trakt pagination limits.");
  }

  const items: unknown[] = [];
  let pageCount = 1;
  let itemCount = 0;
  for (let page = 1; page <= pageCount; page += 1) {
    if (page > maxPages) {
      throw new Error(`Trakt ${path} requires ${pageCount} pages; the safe limit is ${maxPages}.`);
    }
    const result = await traktGetPage(path, clientId, accessToken, fetcher, apiBase, { page, limit });
    items.push(...result.items);
    pageCount = result.pageCount;
    itemCount = result.itemCount;
  }
  return { items, pagesFetched: pageCount, pageCount, itemCount };
}

export async function traktGetPage(
  path: string,
  clientId: string,
  accessToken: string,
  fetcher: typeof fetch,
  apiBase = "https://api.trakt.tv",
  options: { page?: number; limit?: number } = {}
): Promise<TraktPageResult> {
  const page = options.page ?? 1;
  const limit = options.limit ?? 100;
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1) {
    throw new Error("Invalid Trakt page request.");
  }
  const pagePath = withPagination(path, page, limit);
  const response = await fetcher(`${apiBase.replace(/\/$/, "")}${pagePath}`, {
    headers: traktHeaders(clientId, accessToken)
  });
  if (!response.ok) throw new Error(`Trakt ${pagePath} failed with HTTP ${response.status}.`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error(`Trakt ${pagePath} response must be an array.`);
  return {
    items: payload,
    page,
    pageCount: Math.max(1, paginationInt(response.headers.get("x-pagination-page-count"), 1)),
    itemCount: paginationInt(response.headers.get("x-pagination-item-count"), payload.length)
  };
}

export async function traktPost(
  path: string,
  payload: Record<string, unknown>,
  clientId: string,
  accessToken: string,
  fetcher: typeof fetch,
  apiBase = "https://api.trakt.tv"
): Promise<unknown> {
  const response = await fetcher(`${apiBase.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "trakt-api-version": "2",
      "trakt-api-key": clientId,
      authorization: `Bearer ${accessToken}`,
      "user-agent": "SYNCIO/0.1.0 self-hosted"
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`Trakt ${path} failed with HTTP ${response.status}.`);
  return response.json();
}

export async function getStremioRatingStatus(
  authKey: string,
  mediaId: string,
  mediaType: "movie" | "series",
  fetcher: typeof fetch,
  apiBase = "https://likes.stremio.com/api"
): Promise<StremioRatingStatus> {
  const url = new URL(`${apiBase.replace(/\/$/, "")}/get_status`);
  url.searchParams.set("authToken", authKey);
  url.searchParams.set("mediaId", mediaId);
  url.searchParams.set("mediaType", mediaType);
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`Stremio rating lookup failed with HTTP ${response.status}.`);
  const payload = await response.json() as { status?: unknown };
  return parseRatingStatus(payload.status);
}

export async function sendStremioRatingStatus(
  authKey: string,
  mediaId: string,
  mediaType: "movie" | "series",
  status: StremioRatingStatus,
  fetcher: typeof fetch,
  apiBase = "https://likes.stremio.com/api"
): Promise<unknown> {
  const response = await fetcher(`${apiBase.replace(/\/$/, "")}/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ authToken: authKey, mediaId, mediaType, status })
  });
  if (!response.ok) throw new Error(`Stremio rating update failed with HTTP ${response.status}.`);
  return response.json();
}

export async function getCinemetaVideoSets(
  imdbIds: string[],
  fetcher: typeof fetch,
  endpoint = "https://v3-cinemeta.strem.io/catalog/series/video-ids/imdbIds="
): Promise<CinemetaVideoSet[]> {
  if (imdbIds.length === 0) return [];
  const output: CinemetaVideoSet[] = [];
  for (let index = 0; index < imdbIds.length; index += 100) {
    const chunk = imdbIds.slice(index, index + 100);
    const response = await fetcher(`${endpoint}${chunk.map(encodeURIComponent).join(",")}`);
    if (!response.ok) throw new Error(`Cinemeta video-id request failed with HTTP ${response.status}.`);
    const payload = recordValue(await response.json(), "Cinemeta video-id response");
    if (!Array.isArray(payload.metasDetailed)) throw new Error("Cinemeta response has no metasDetailed array.");
    output.push(...payload.metasDetailed.map((value) => {
      const meta = recordValue(value, "Cinemeta metadata");
      const videos = Array.isArray(meta.videos) ? meta.videos.map((video) => {
        if (typeof video === "string") return video;
        const record = recordValue(video, "Cinemeta video");
        return typeof record.id === "string" ? record.id : null;
      }).filter((id): id is string => id !== null) : [];
      return {
        id: typeof meta.id === "string" ? meta.id : "",
        name: typeof meta.name === "string" ? meta.name : null,
        videos
      };
    }).filter((item) => item.id.length > 0));
  }
  return output;
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new Error(`${label} must be an object.`);
}

function traktHeaders(clientId: string, accessToken: string): Record<string, string> {
  return {
    accept: "application/json",
    "content-type": "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": clientId,
    authorization: `Bearer ${accessToken}`,
    "user-agent": "SYNCIO/0.1.0 self-hosted"
  };
}

function withPagination(path: string, page: number, limit: number): string {
  const url = new URL(path, "https://syncio.invalid");
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));
  return `${url.pathname}${url.search}`;
}

function paginationInt(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseRatingStatus(value: unknown): StremioRatingStatus {
  if (value === "watched" || value === "liked" || value === "loved") return value;
  return null;
}
