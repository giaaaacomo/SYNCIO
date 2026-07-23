export class TraktApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSeconds: number | null = null
  ) {
    super(message);
  }
}

export function traktApiError(message: string, response: Response): TraktApiError {
  return new TraktApiError(message, response.status, retryAfterSeconds(response));
}

function retryAfterSeconds(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1, Math.ceil(seconds));
  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt)) return null;
  return Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
}
