import { redact, shapeOf } from "./probe.js";

export interface JsonResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  shape: unknown;
}

const INTERESTING_HEADERS = [
  "retry-after",
  "x-ratelimit",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-pagination-page",
  "x-pagination-limit",
  "x-pagination-page-count",
  "x-pagination-item-count",
  "content-type"
];

export async function requestJson(
  url: string,
  init: RequestInit = {},
  timeoutMs = 30_000
): Promise<JsonResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    });
    const text = await response.text();
    const body = parseBody(text);

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: pickHeaders(response.headers),
      body,
      shape: shapeOf(body)
    };
  } finally {
    clearTimeout(timer);
  }
}

export function sanitizedRequest(url: string, init: RequestInit = {}): unknown {
  return redact({
    url,
    method: init.method ?? "GET",
    headers: init.headers ?? {}
  });
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { rawTextPreview: text.slice(0, 500), rawTextLength: text.length };
  }
}

function pickHeaders(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};
  for (const key of INTERESTING_HEADERS) {
    const value = headers.get(key);
    if (value !== null) output[key] = value;
  }
  return output;
}
