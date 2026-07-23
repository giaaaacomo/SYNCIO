import type { IncomingMessage, ServerResponse } from "node:http";
import { configurePage } from "./configure-page.js";
import { ProbeAbort } from "../lib/probe.js";
import { loadSyncSettings, parseSyncSettings, saveSyncSettings } from "../lib/sync-settings.js";
import { SYNCIO_MANIFEST, manifestUrl, stremioInstallUrl } from "./manifest.js";
import { readAddonRuntimeStatus } from "./status.js";
import { statusCatalog } from "./status-catalog.js";
import {
  applyFullSync,
  applyRatingsSync,
  applyWatchedSyncTest,
  applyWatchlistSync,
  previewFullSync,
  previewRatingsSync,
  previewWatchedSync,
  previewWatchlistSync
} from "./sync-preview.js";
import { pollTraktDeviceOAuth, startTraktDeviceOAuth, verifyTraktAccount } from "./trakt-oauth.js";

export interface AddonRequest {
  method: string;
  url: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: string;
}

export interface AddonResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type"
};

export async function handleAddonRequest(request: AddonRequest, origin: string): Promise<AddonResponse> {
  const method = request.method.toUpperCase();
  const url = new URL(request.url, origin);

  if (method === "OPTIONS") {
    return { status: 204, headers: CORS_HEADERS, body: "" };
  }

  if (method === "POST" && url.pathname === "/oauth/trakt/start") {
    const result = await startTraktDeviceOAuth();
    return json(result.status, result.body);
  }

  if (method === "POST" && url.pathname === "/oauth/trakt/poll") {
    const result = await pollTraktDeviceOAuth();
    return json(result.status, result.body);
  }

  if (method === "POST" && url.pathname === "/account/trakt/verify") {
    const result = await verifyTraktAccount();
    return json(result.status, result.body);
  }

  if (method === "GET" && url.pathname === "/sync/settings") {
    return json(200, await loadSyncSettings());
  }

  if (method === "POST" && url.pathname === "/sync/settings") {
    const settings = parseSettingsBody(request.body);
    await saveSyncSettings(settings);
    return json(200, settings);
  }

  if (method === "POST" && url.pathname === "/sync/preview") {
    const result = await previewFullSync();
    return json(result.status, result.body);
  }

  if (method === "POST" && url.pathname === "/sync/run") {
    const result = await applyFullSync();
    return json(result.status, result.body);
  }

  if (method === "POST" && url.pathname === "/sync/watched/preview") {
    const result = await previewWatchedSync();
    return json(result.status, result.body);
  }

  if (method === "POST" && url.pathname === "/sync/watched/apply") {
    const result = await applyWatchedSyncTest();
    return json(result.status, result.body);
  }

  if (method === "POST" && url.pathname === "/sync/ratings/preview") {
    const result = await previewRatingsSync();
    return json(result.status, result.body);
  }

  if (method === "POST" && url.pathname === "/sync/ratings/apply") {
    const result = await applyRatingsSync();
    return json(result.status, result.body);
  }

  if (method === "POST" && url.pathname === "/sync/watchlist/preview") {
    const result = await previewWatchlistSync();
    return json(result.status, result.body);
  }

  if (method === "POST" && url.pathname === "/sync/watchlist/apply") {
    const result = await applyWatchlistSync();
    return json(result.status, result.body);
  }

  if (method !== "GET") {
    return text(405, "Method not allowed");
  }

  if (url.pathname === "/" || url.pathname === "/configure") {
    return html(200, configurePage(origin, readAddonRuntimeStatus(), await loadSyncSettings()));
  }

  if (url.pathname === "/manifest.json") {
    return json(200, SYNCIO_MANIFEST);
  }

  if (url.pathname === "/healthz") {
    return json(200, { ok: true, service: "syncio-addon" });
  }

  if (url.pathname === "/status.json") {
    const status = readAddonRuntimeStatus();
    return json(200, {
      addon: {
        id: SYNCIO_MANIFEST.id,
        version: SYNCIO_MANIFEST.version,
        manifestUrl: manifestUrl(origin),
        installUrl: stremioInstallUrl(origin)
      },
      accounts: status.accounts,
      sync: status.sync
    });
  }

  if (url.pathname === "/catalog/movie/syncio-status.json") {
    return json(200, statusCatalog());
  }

  return text(404, "Not found");
}

export function nodeRequestHandler(host: string, port: number) {
  const origin = `http://${host}:${port}`;
  return async (request: IncomingMessage, response: ServerResponse) => {
    const result = await handleAddonRequestSafe({
      method: request.method ?? "GET",
      url: request.url ?? "/",
      headers: request.headers,
      body: await readRequestBody(request)
    }, origin);
    response.writeHead(result.status, result.headers);
    response.end(result.body);
  };
}

function parseSettingsBody(body: string | undefined) {
  if (!body) throw new Error("Missing sync settings request body.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("Sync settings request body must be valid JSON.");
  }
  return parseSyncSettings(parsed, "request body");
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > 64 * 1024) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handleAddonRequestSafe(request: AddonRequest, origin: string): Promise<AddonResponse> {
  try {
    return await handleAddonRequest(request, origin);
  } catch (error) {
    if (error instanceof ProbeAbort) {
      return json(error.status === "FAIL" ? 400 : 200, { error: error.message });
    }
    return json(500, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function html(status: number, body: string): AddonResponse {
  return {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8"
    },
    body
  };
}

function json(status: number, value: unknown): AddonResponse {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...CORS_HEADERS
    },
    body: `${JSON.stringify(value, null, 2)}\n`
  };
}

function text(status: number, body: string): AddonResponse {
  return {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8"
    },
    body
  };
}
