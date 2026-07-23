import { updateDotEnv } from "./lib/env-file.js";
import { requestJson } from "./lib/http.js";
import { env, printJson, requireEnv, runProbe } from "./lib/probe.js";

await runProbe("trakt-device-start", async () => {
  const base = env("TRAKT_API_BASE") ?? "https://api.trakt.tv";
  const clientId = requireEnv("TRAKT_CLIENT_ID");
  const response = await requestJson(`${base}/oauth/device/code`, {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "trakt-api-version": "2",
      "trakt-api-key": clientId,
      "user-agent": env("SYNCIO_USER_AGENT") ?? "SYNCIO/0.0.0 research"
    },
    body: JSON.stringify({ client_id: clientId })
  });

  if (!response.ok) {
    return {
      status: "FAIL",
      message: `Trakt device code request failed with HTTP ${response.status}.`,
      details: { headers: response.headers, shape: response.shape, body: response.body }
    };
  }

  const body = response.body;
  if (!body || typeof body !== "object") {
    return { status: "FAIL", message: "Trakt device code response was not an object." };
  }

  const record = body as Record<string, unknown>;
  const deviceCode = record.device_code;
  const userCode = record.user_code;
  const verificationUrl = record.verification_url;
  if (typeof deviceCode !== "string" || typeof userCode !== "string" || typeof verificationUrl !== "string") {
    return {
      status: "FAIL",
      message: "Trakt device code response did not include expected fields.",
      details: { shape: response.shape }
    };
  }

  updateDotEnv({ TRAKT_DEVICE_CODE: deviceCode });

  printJson("next", {
    visit: verificationUrl,
    enterCode: userCode,
    thenRun: "npm run probe:trakt:device-poll"
  });

  return {
    status: "PASS",
    message: "Device authorization started. TRAKT_DEVICE_CODE was saved to .env; authorize in the browser, then poll.",
    details: {
      savedDeviceCode: true,
      expiresIn: record.expires_in,
      interval: record.interval
    }
  };
});
