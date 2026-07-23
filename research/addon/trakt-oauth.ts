import { updateDotEnv } from "../lib/env-file.js";
import { requestJson } from "../lib/http.js";
import { env, requireEnv } from "../lib/probe.js";
import { readTraktAccountSummary } from "../lib/trakt.js";

export interface AddonTraktOAuthResult {
  status: number;
  body: unknown;
}

export async function startTraktDeviceOAuth(): Promise<AddonTraktOAuthResult> {
  let clientId: string;
  try {
    clientId = requireEnv("TRAKT_CLIENT_ID");
  } catch (error) {
    return addonError(400, error instanceof Error ? error.message : "Missing TRAKT_CLIENT_ID.");
  }

  const response = await requestJson(`${traktBase()}/oauth/device/code`, {
    method: "POST",
    headers: traktDeviceHeaders(clientId),
    body: JSON.stringify({ client_id: clientId })
  });

  if (!response.ok) return addonError(response.status, "Trakt device code request failed.");

  const record = objectRecord(response.body);
  const deviceCode = stringValue(record.device_code);
  const userCode = stringValue(record.user_code);
  const verificationUrl = stringValue(record.verification_url);
  if (!deviceCode || !userCode || !verificationUrl) {
    return addonError(502, "Trakt device code response did not include expected fields.");
  }

  updateDotEnv({ TRAKT_DEVICE_CODE: deviceCode });

  return {
    status: 200,
    body: {
      verificationUrl,
      userCode,
      expiresIn: numberValue(record.expires_in),
      interval: numberValue(record.interval),
      savedDeviceCode: true
    }
  };
}

export async function pollTraktDeviceOAuth(): Promise<AddonTraktOAuthResult> {
  let clientId: string;
  let deviceCode: string;
  try {
    clientId = requireEnv("TRAKT_CLIENT_ID");
    deviceCode = requireEnv("TRAKT_DEVICE_CODE");
  } catch (error) {
    return addonError(400, error instanceof Error ? error.message : "Missing Trakt OAuth environment.");
  }

  const response = await requestJson(`${traktBase()}/oauth/device/token`, {
    method: "POST",
    headers: traktDeviceHeaders(clientId),
    body: JSON.stringify({ code: deviceCode, client_id: clientId })
  });

  if (!response.ok) {
    const body = objectRecord(response.body);
    const error = stringValue(body.error);
    const description = stringValue(body.error_description);
    if (error === "authorization_pending") {
      return { status: 202, body: { authorized: false, error } };
    }
    return addonError(response.status, description ? `${error ?? "Trakt error"}: ${description}` : error ?? "Trakt device poll failed.");
  }

  const record = objectRecord(response.body);
  const accessToken = stringValue(record.access_token);
  const refreshToken = stringValue(record.refresh_token);
  if (!accessToken || !refreshToken) {
    return addonError(502, "Trakt token response did not include access and refresh tokens.");
  }

  updateDotEnv({
    TRAKT_ACCESS_TOKEN: accessToken,
    TRAKT_REFRESH_TOKEN: refreshToken
  });

  return {
    status: 200,
    body: {
      authorized: true,
      savedTokens: true,
      expiresIn: numberValue(record.expires_in)
    }
  };
}

export async function verifyTraktAccount(): Promise<AddonTraktOAuthResult> {
  try {
    const account = await readTraktAccountSummary();
    const expectedUsername = env("TRAKT_EXPECTED_USERNAME");
    const guard = expectedUsername
      ? account.username === expectedUsername ? "matched" : "mismatch"
      : "not_set";

    return {
      status: guard === "mismatch" ? 409 : 200,
      body: {
        account: {
          username: account.username,
          slug: account.slug,
          private: account.private,
          vip: account.vip,
          joinedAt: account.joinedAt
        },
        guard
      }
    };
  } catch (error) {
    return addonError(400, error instanceof Error ? error.message : "Trakt account verification failed.");
  }
}

function traktBase(): string {
  return env("TRAKT_API_BASE") ?? "https://api.trakt.tv";
}

function traktDeviceHeaders(clientId: string): HeadersInit {
  return {
    "accept": "application/json",
    "content-type": "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": clientId,
    "user-agent": env("SYNCIO_USER_AGENT") ?? "SYNCIO/0.1.0 addon"
  };
}

function addonError(status: number, message: string): AddonTraktOAuthResult {
  return { status, body: { error: message } };
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
