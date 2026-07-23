import { updateDotEnv } from "./lib/env-file.js";
import { requestJson } from "./lib/http.js";
import { env, intFlag, requireEnv, runProbe } from "./lib/probe.js";

await runProbe("trakt-device-poll", async (args) => {
  const base = env("TRAKT_API_BASE") ?? "https://api.trakt.tv";
  const maxAttempts = intFlag(args, "max-attempts", 30);
  const intervalSeconds = intFlag(args, "interval", 5);
  const deviceCode = requireEnv("TRAKT_DEVICE_CODE");
  const clientId = requireEnv("TRAKT_CLIENT_ID");
  const headers = {
    "accept": "application/json",
    "content-type": "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": clientId,
    "user-agent": env("SYNCIO_USER_AGENT") ?? "SYNCIO/0.0.0 research"
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await requestJson(`${base}/oauth/device/token`, {
      method: "POST",
      headers,
      body: JSON.stringify({ code: deviceCode, client_id: clientId })
    });

    if (response.ok) {
      const body = response.body;
      if (!body || typeof body !== "object") {
        return { status: "FAIL", message: "Trakt token response was not an object." };
      }

      const record = body as Record<string, unknown>;
      const accessToken = record.access_token;
      const refreshToken = record.refresh_token;
      if (typeof accessToken !== "string" || typeof refreshToken !== "string") {
        return { status: "FAIL", message: "Trakt token response did not include access and refresh tokens." };
      }

      updateDotEnv({
        TRAKT_ACCESS_TOKEN: accessToken,
        TRAKT_REFRESH_TOKEN: refreshToken
      });

      return {
        status: "PASS",
        message: "Trakt Device OAuth completed and tokens were saved to .env.",
        details: {
          attempts: attempt,
          accessTokenLength: accessToken.length,
          refreshTokenLength: refreshToken.length,
          expiresIn: record.expires_in
        }
      };
    }

    const body = response.body && typeof response.body === "object"
      ? response.body as Record<string, unknown>
      : {};
    const error = typeof body.error === "string" ? body.error : undefined;
    if (error && error !== "authorization_pending") {
      return {
        status: "FAIL",
        message: `Trakt device poll failed: ${error}.`,
        details: { status: response.status, shape: response.shape, body }
      };
    }

    await sleep(intervalSeconds * 1000);
  }

  return {
    status: "FAIL",
    message: "Timed out waiting for Trakt device authorization."
  };
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
