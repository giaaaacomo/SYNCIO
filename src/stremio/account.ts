const DEFAULT_STREMIO_API_BASE = "https://api.strem.io";

export interface StremioIdentity {
  userId: string;
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
