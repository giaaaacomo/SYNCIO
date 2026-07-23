import { authorizeSetup } from "./auth/setup-auth.js";
import { decryptSecret, encryptSecret } from "./crypto/secrets.js";
import { manifest, SYNCIO_VERSION } from "./manifest.js";
import { isD1Database, readStorageStatus } from "./storage/d1.js";
import { getConnection, upsertConnection, type ConnectionRecord } from "./storage/repositories/connections.js";
import {
  deleteTraktDeviceSession,
  getTraktDeviceSession,
  upsertTraktDeviceSession,
  type TraktDeviceSession
} from "./storage/repositories/trakt-device-sessions.js";
import { getLatestSyncRun } from "./storage/repositories/sync-runs.js";
import {
  ensureUser,
  getHostedSyncSettings,
  getLiveSyncActivation,
  upsertHostedSyncSettings,
  type HostedSyncSettings
} from "./storage/repositories/users.js";
import { fetchStremioIdentity, loginToStremio, StremioApiError } from "./stremio/account.js";
import { activateWorkerSync, applyWorkerSync } from "./sync/apply.js";
import { previewWorkerSync } from "./sync/preview.js";
import { runScheduledSync } from "./sync/scheduled.js";
import {
  fetchTraktIdentity,
  pollTraktDeviceAuthorization,
  startTraktDeviceAuthorization
} from "./trakt/device-oauth.js";
import { TraktApiError } from "./trakt/api-error.js";

interface Env {
  SYNCIO_DB?: unknown;
  SYNCIO_ENCRYPTION_KEY?: string;
  SYNCIO_SETUP_TOKEN?: string;
  TRAKT_API_BASE?: string;
  STREMIO_API_BASE?: string;
  STREMIO_LIKES_BASE?: string;
  CINEMETA_VIDEO_IDS_BASE?: string;
}

const SELF_HOST_USER_ID = "self-host";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
  "access-control-allow-headers": "authorization, content-type"
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },

  async scheduled(_event: unknown, env: Env): Promise<void> {
    if (!isD1Database(env.SYNCIO_DB) || !env.SYNCIO_ENCRYPTION_KEY) return;
    await runScheduledSync({
      db: env.SYNCIO_DB,
      userId: SELF_HOST_USER_ID,
      encryptionKey: env.SYNCIO_ENCRYPTION_KEY,
      fetcher: fetch,
      traktApiBase: env.TRAKT_API_BASE,
      stremioApiBase: env.STREMIO_API_BASE,
      stremioLikesBase: env.STREMIO_LIKES_BASE,
      cinemetaVideoIdsBase: env.CINEMETA_VIDEO_IDS_BASE
    });
  }
};

export async function handleRequest(request: Request, env: Env, externalFetch: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  const origin = url.origin;

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

  if (url.pathname.startsWith("/api/setup/") || url.pathname.startsWith("/api/sync/")) {
    const authorization = await authorizeSetup(request, env.SYNCIO_SETUP_TOKEN);
    if (!authorization.ok) return json({ error: authorization.error }, authorization.status);
  }

  if (url.pathname === "/api/setup/settings" && request.method === "GET") {
    if (!isD1Database(env.SYNCIO_DB)) return json({ error: "D1 binding is not configured." }, 503);
    const [settings, activation] = await Promise.all([
      getHostedSyncSettings(env.SYNCIO_DB, SELF_HOST_USER_ID),
      getLiveSyncActivation(env.SYNCIO_DB, SELF_HOST_USER_ID)
    ]);
    return json({
      ...settings,
      liveSync: activation ? "active" : "inactive",
      liveActivatedAt: activation?.activatedAt ?? null
    });
  }

  if (url.pathname === "/api/setup/settings" && request.method === "PUT") {
    if (!isD1Database(env.SYNCIO_DB)) return json({ error: "D1 binding is not configured." }, 503);
    try {
      const settings = parseHostedSyncSettings(await request.json());
      await ensureUser(env.SYNCIO_DB, SELF_HOST_USER_ID);
      const current = await getHostedSyncSettings(env.SYNCIO_DB, SELF_HOST_USER_ID);
      if (settings.scope === "account" && current.scope !== "account") {
        return json({ error: "Run a preview and use Activate Live Sync instead." }, 409);
      }
      return json(await upsertHostedSyncSettings(env.SYNCIO_DB, SELF_HOST_USER_ID, settings));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Invalid sync settings." }, 400);
    }
  }

  if (url.pathname === "/api/setup/status" && request.method === "GET") {
    return json(await setupStatus(env));
  }

  if (url.pathname === "/api/setup/trakt-app" && request.method === "POST") {
    return saveTraktAppCredentials(request, env);
  }

  if (url.pathname === "/api/setup/trakt/start" && request.method === "POST") {
    return startTraktLink(env, externalFetch);
  }

  if (url.pathname === "/api/setup/trakt/poll" && request.method === "POST") {
    return pollTraktLink(env, externalFetch);
  }

  if (url.pathname === "/api/setup/stremio" && request.method === "POST") {
    return linkStremio(request, env, externalFetch);
  }

  if (url.pathname === "/api/sync/activate" && request.method === "POST") {
    if (!isD1Database(env.SYNCIO_DB)) return json({ error: "D1 binding is not configured." }, 503);
    if (!env.SYNCIO_ENCRYPTION_KEY) return json({ error: "SYNCIO_ENCRYPTION_KEY is not configured." }, 503);
    try {
      const body = objectValue(await request.json(), "body");
      const expectedFingerprint = fingerprintValue(body.fingerprint);
      const confirmation = stringValue(body.confirmation, "confirmation");
      return json(await activateWorkerSync({
        db: env.SYNCIO_DB,
        userId: SELF_HOST_USER_ID,
        encryptionKey: env.SYNCIO_ENCRYPTION_KEY,
        expectedFingerprint,
        confirmation,
        fetcher: externalFetch,
        traktApiBase: env.TRAKT_API_BASE,
        stremioApiBase: env.STREMIO_API_BASE,
        stremioLikesBase: env.STREMIO_LIKES_BASE,
        cinemetaVideoIdsBase: env.CINEMETA_VIDEO_IDS_BASE
      }));
    } catch (error) {
      return syncErrorResponse(error, "Live sync activation failed.", 409);
    }
  }

  if (url.pathname === "/api/sync/apply" && request.method === "POST") {
    if (!isD1Database(env.SYNCIO_DB)) return json({ error: "D1 binding is not configured." }, 503);
    if (!env.SYNCIO_ENCRYPTION_KEY) return json({ error: "SYNCIO_ENCRYPTION_KEY is not configured." }, 503);
    try {
      const body = objectValue(await request.json(), "body");
      const expectedFingerprint = fingerprintValue(body.fingerprint);
      return json(await applyWorkerSync({
        db: env.SYNCIO_DB,
        userId: SELF_HOST_USER_ID,
        encryptionKey: env.SYNCIO_ENCRYPTION_KEY,
        expectedFingerprint,
        fetcher: externalFetch,
        traktApiBase: env.TRAKT_API_BASE,
        stremioApiBase: env.STREMIO_API_BASE,
        stremioLikesBase: env.STREMIO_LIKES_BASE,
        cinemetaVideoIdsBase: env.CINEMETA_VIDEO_IDS_BASE
      }));
    } catch (error) {
      return syncErrorResponse(error, "Sync apply failed.", 409);
    }
  }

  if (url.pathname === "/api/sync/run" && request.method === "POST") {
    if (!isD1Database(env.SYNCIO_DB)) return json({ error: "D1 binding is not configured." }, 503);
    if (!env.SYNCIO_ENCRYPTION_KEY) return json({ error: "SYNCIO_ENCRYPTION_KEY is not configured." }, 503);
    try {
      return json(await runScheduledSync({
        db: env.SYNCIO_DB,
        userId: SELF_HOST_USER_ID,
        encryptionKey: env.SYNCIO_ENCRYPTION_KEY,
        fetcher: externalFetch,
        traktApiBase: env.TRAKT_API_BASE,
        stremioApiBase: env.STREMIO_API_BASE,
        stremioLikesBase: env.STREMIO_LIKES_BASE,
        cinemetaVideoIdsBase: env.CINEMETA_VIDEO_IDS_BASE,
        mode: "manual"
      }));
    } catch (error) {
      return syncErrorResponse(error, "Sync run failed.", 500);
    }
  }

  if (request.method !== "GET") {
    return text("Method not allowed", 405);
  }

  if (url.pathname === "/" || url.pathname === "/configure") {
    return html(configurePage(origin));
  }

  if (url.pathname === "/manifest.json") {
    return json(manifest(origin));
  }

  if (url.pathname === "/healthz") {
    return json({ ok: true, service: "syncio-worker" });
  }

  if (url.pathname === "/status.json") {
    const storage = await readStorageStatus(env.SYNCIO_DB);
    return json({
      addon: {
        id: "community.syncio",
        version: SYNCIO_VERSION,
        manifestUrl: `${origin}/manifest.json`
      },
      storage,
      sync: {
        engine: "bidirectional-guarded-apply",
        scheduler: "hourly-live-when-activated"
      }
    });
  }

  if (url.pathname === "/api/status") {
    return json({
      ok: true,
      storage: await readStorageStatus(env.SYNCIO_DB),
      sync: {
        preview: "read-only-baseline",
        run: "bidirectional-guarded-apply"
      }
    });
  }

  if (url.pathname === "/api/sync/preview") {
    if (!isD1Database(env.SYNCIO_DB)) return json({ error: "D1 binding is not configured." }, 503);
    if (!env.SYNCIO_ENCRYPTION_KEY) return json({ error: "SYNCIO_ENCRYPTION_KEY is not configured." }, 503);
    try {
      return json(await previewWorkerSync({
        db: env.SYNCIO_DB,
        userId: SELF_HOST_USER_ID,
        encryptionKey: env.SYNCIO_ENCRYPTION_KEY,
        fetcher: externalFetch,
        traktApiBase: env.TRAKT_API_BASE,
        stremioApiBase: env.STREMIO_API_BASE,
        stremioLikesBase: env.STREMIO_LIKES_BASE,
        cinemetaVideoIdsBase: env.CINEMETA_VIDEO_IDS_BASE
      }));
    } catch (error) {
      return syncErrorResponse(error, "Sync preview failed.", 500);
    }
  }

  if (url.pathname === "/catalog/movie/syncio-status.json") {
    return json({
      metas: [
        {
          id: "syncio:status",
          type: "movie",
          name: "SYNCIO Status",
          poster: `${origin}/status-poster.svg`,
          description: "Self-hosted SYNCIO shell is reachable."
        }
      ]
    });
  }

  if (url.pathname === "/status-poster.svg") {
    return svg(statusPoster());
  }

  return text("Not found", 404);
}

async function setupStatus(env: Env) {
  const storage = await readStorageStatus(env.SYNCIO_DB);
  const connection = storage.reachable && isD1Database(env.SYNCIO_DB)
    ? await getConnection(env.SYNCIO_DB, SELF_HOST_USER_ID).catch(() => null)
    : null;
  const deviceSession = storage.reachable && isD1Database(env.SYNCIO_DB)
    ? await getTraktDeviceSession(env.SYNCIO_DB, SELF_HOST_USER_ID).catch(() => null)
    : null;
  const latestRun = storage.reachable && isD1Database(env.SYNCIO_DB)
    ? await getLatestSyncRun(env.SYNCIO_DB, SELF_HOST_USER_ID).catch(() => null)
    : null;
  return {
    install: {
      mode: "self-host",
      id: SELF_HOST_USER_ID
    },
    storage: {
      d1: storage.d1Binding,
      reachable: storage.reachable
    },
    encryption: env.SYNCIO_ENCRYPTION_KEY ? "configured" : "missing",
    connections: summarizeConnection(connection),
    traktDevice: summarizeDeviceSession(deviceSession),
    latestRun
  };
}

async function saveTraktAppCredentials(request: Request, env: Env): Promise<Response> {
  if (!isD1Database(env.SYNCIO_DB)) return json({ error: "D1 binding is not configured." }, 503);
  if (!env.SYNCIO_ENCRYPTION_KEY) return json({ error: "SYNCIO_ENCRYPTION_KEY is not configured." }, 503);

  let body: Record<string, unknown>;
  try {
    body = objectValue(await request.json(), "body");
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid JSON body." }, 400);
  }

  let clientId: string;
  let clientSecret: string;
  let redirectUri: string;
  try {
    clientId = trimmedString(body.clientId, "clientId");
    clientSecret = trimmedString(body.clientSecret, "clientSecret");
    redirectUri = httpUrl(body.redirectUri, "redirectUri");
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid Trakt app credentials." }, 400);
  }
  try {
    const encryptedClientId = await encryptSecret(clientId, env.SYNCIO_ENCRYPTION_KEY, `${SELF_HOST_USER_ID}:trakt-client-id`);
    const encryptedClientSecret = await encryptSecret(
      clientSecret,
      env.SYNCIO_ENCRYPTION_KEY,
      `${SELF_HOST_USER_ID}:trakt-client-secret`
    );

    await ensureUser(env.SYNCIO_DB, SELF_HOST_USER_ID);
    const connection = await upsertConnection(env.SYNCIO_DB, SELF_HOST_USER_ID, {
      traktClientIdCiphertext: encryptedClientId.value,
      traktClientSecretCiphertext: encryptedClientSecret.value,
      traktRedirectUri: redirectUri,
      traktAccessCiphertext: null,
      traktRefreshCiphertext: null,
      traktExpiresAt: null,
      traktUsername: null,
      encryptionVersion: encryptedClientId.encryptionVersion
    });
    await deleteTraktDeviceSession(env.SYNCIO_DB, SELF_HOST_USER_ID);

    return json({
      ok: true,
      connections: summarizeConnection(connection)
    });
  } catch {
    return json({ error: "Could not encrypt or save Trakt app credentials." }, 500);
  }
}

async function startTraktLink(env: Env, externalFetch: typeof fetch): Promise<Response> {
  const prerequisites = await traktSetupPrerequisites(env);
  if (prerequisites instanceof Response) return prerequisites;

  try {
    const authorization = await startTraktDeviceAuthorization(
      prerequisites.clientId,
      externalFetch,
      env.TRAKT_API_BASE
    );
    const now = Date.now();
    const encryptedDeviceCode = await encryptSecret(
      authorization.deviceCode,
      prerequisites.encryptionKey,
      `${SELF_HOST_USER_ID}:trakt-device-code`
    );
    const session = await upsertTraktDeviceSession(prerequisites.db, SELF_HOST_USER_ID, {
      deviceCodeCiphertext: encryptedDeviceCode.value,
      userCode: authorization.userCode,
      verificationUrl: authorization.verificationUrl,
      expiresAt: new Date(now + authorization.expiresIn * 1000).toISOString(),
      intervalSeconds: authorization.interval,
      nextPollAt: new Date(now + authorization.interval * 1000).toISOString()
    });
    return json({ ok: true, authorization: summarizeDeviceSession(session) });
  } catch (error) {
    return externalServiceError(error, "Could not start Trakt authorization.");
  }
}

async function pollTraktLink(env: Env, externalFetch: typeof fetch): Promise<Response> {
  const prerequisites = await traktSetupPrerequisites(env);
  if (prerequisites instanceof Response) return prerequisites;
  const session = await getTraktDeviceSession(prerequisites.db, SELF_HOST_USER_ID);
  if (!session) return json({ error: "No active Trakt authorization. Start a new link first." }, 409);

  const now = Date.now();
  if (Date.parse(session.expiresAt) <= now) {
    await deleteTraktDeviceSession(prerequisites.db, SELF_HOST_USER_ID);
    return json({ error: "Trakt authorization expired. Start a new link." }, 410);
  }
  const retryAfterSeconds = secondsUntil(session.nextPollAt, now);
  if (retryAfterSeconds > 0) {
    return json({ error: "Wait before checking Trakt again.", state: "slow-down", retryAfterSeconds }, 429);
  }

  try {
    const deviceCode = await decryptSecret(
      session.deviceCodeCiphertext,
      prerequisites.encryptionKey,
      `${SELF_HOST_USER_ID}:trakt-device-code`
    );
    const result = await pollTraktDeviceAuthorization(
      prerequisites.clientId,
      prerequisites.clientSecret,
      deviceCode,
      externalFetch,
      env.TRAKT_API_BASE
    );

    if (result.kind === "pending") {
      const updated = await rescheduleDevicePoll(prerequisites.db, session, session.intervalSeconds, now);
      return json({
        ok: false,
        state: "pending",
        retryAfterSeconds: updated.intervalSeconds,
        authorization: summarizeDeviceSession(updated)
      }, 202);
    }
    if (result.kind === "slow-down") {
      const updated = await rescheduleDevicePoll(prerequisites.db, session, session.intervalSeconds + 5, now);
      return json({
        error: "Trakt requested slower polling.",
        state: "slow-down",
        retryAfterSeconds: updated.intervalSeconds,
        authorization: summarizeDeviceSession(updated)
      }, 429);
    }
    if (result.kind !== "authorized") {
      await deleteTraktDeviceSession(prerequisites.db, SELF_HOST_USER_ID);
      const status = result.kind === "expired" ? 410 : 400;
      return json({ error: terminalTraktMessage(result.kind), state: result.kind }, status);
    }

    const identity = await fetchTraktIdentity(
      prerequisites.clientId,
      result.tokens.accessToken,
      externalFetch,
      env.TRAKT_API_BASE
    );
    const [encryptedAccess, encryptedRefresh] = await Promise.all([
      encryptSecret(result.tokens.accessToken, prerequisites.encryptionKey, `${SELF_HOST_USER_ID}:trakt-access`),
      encryptSecret(result.tokens.refreshToken, prerequisites.encryptionKey, `${SELF_HOST_USER_ID}:trakt-refresh`)
    ]);
    const expiresAt = new Date((result.tokens.createdAt + result.tokens.expiresIn) * 1000).toISOString();
    const connection = await upsertConnection(prerequisites.db, SELF_HOST_USER_ID, {
      traktAccessCiphertext: encryptedAccess.value,
      traktRefreshCiphertext: encryptedRefresh.value,
      traktExpiresAt: expiresAt,
      traktUsername: identity.username,
      encryptionVersion: encryptedAccess.encryptionVersion
    });
    await deleteTraktDeviceSession(prerequisites.db, SELF_HOST_USER_ID);
    return json({ ok: true, state: "linked", connections: summarizeConnection(connection) });
  } catch (error) {
    return externalServiceError(error, "Could not complete Trakt authorization.");
  }
}

async function linkStremio(request: Request, env: Env, externalFetch: typeof fetch): Promise<Response> {
  if (!isD1Database(env.SYNCIO_DB)) return json({ error: "D1 binding is not configured." }, 503);
  if (!env.SYNCIO_ENCRYPTION_KEY) return json({ error: "SYNCIO_ENCRYPTION_KEY is not configured." }, 503);

  let body: Record<string, unknown>;
  try {
    body = objectValue(await request.json(), "body");
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid JSON body." }, 400);
  }

  try {
    const mode = stringValue(body.mode, "mode");
    let authKey: string;
    if (mode === "auth-key") {
      authKey = boundedSecret(body.authKey, "authKey");
    } else if (mode === "credentials") {
      const email = emailValue(body.email);
      const password = credentialPassword(body.password);
      authKey = await loginToStremio(email, password, externalFetch, env.STREMIO_API_BASE);
    } else {
      return json({ error: "Unsupported Stremio link mode." }, 400);
    }

    const identity = await fetchStremioIdentity(authKey, externalFetch, env.STREMIO_API_BASE);
    const encryptedAuth = await encryptSecret(authKey, env.SYNCIO_ENCRYPTION_KEY, `${SELF_HOST_USER_ID}:stremio-auth`);
    await ensureUser(env.SYNCIO_DB, SELF_HOST_USER_ID);
    const connection = await upsertConnection(env.SYNCIO_DB, SELF_HOST_USER_ID, {
      stremioAuthCiphertext: encryptedAuth.value,
      stremioUserId: identity.userId,
      encryptionVersion: encryptedAuth.encryptionVersion
    });
    return json({ ok: true, connections: summarizeConnection(connection) });
  } catch (error) {
    if (error instanceof StremioApiError) {
      return json({ error: error.message }, error.status >= 500 ? 502 : 400);
    }
    return json({ error: error instanceof Error ? error.message : "Could not link Stremio." }, 400);
  }
}

async function traktSetupPrerequisites(env: Env): Promise<{
  db: import("./storage/d1.js").D1DatabaseLike;
  encryptionKey: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} | Response> {
  if (!isD1Database(env.SYNCIO_DB)) return json({ error: "D1 binding is not configured." }, 503);
  if (!env.SYNCIO_ENCRYPTION_KEY) return json({ error: "SYNCIO_ENCRYPTION_KEY is not configured." }, 503);
  const connection = await getConnection(env.SYNCIO_DB, SELF_HOST_USER_ID);
  if (!connection?.traktClientIdCiphertext || !connection.traktClientSecretCiphertext || !connection.traktRedirectUri) {
    return json({ error: "Save the complete Trakt app configuration before linking Trakt." }, 409);
  }
  try {
    const [clientId, clientSecret] = await Promise.all([
      decryptSecret(connection.traktClientIdCiphertext, env.SYNCIO_ENCRYPTION_KEY, `${SELF_HOST_USER_ID}:trakt-client-id`),
      decryptSecret(connection.traktClientSecretCiphertext, env.SYNCIO_ENCRYPTION_KEY, `${SELF_HOST_USER_ID}:trakt-client-secret`)
    ]);
    return {
      db: env.SYNCIO_DB,
      encryptionKey: env.SYNCIO_ENCRYPTION_KEY,
      clientId,
      clientSecret,
      redirectUri: connection.traktRedirectUri
    };
  } catch {
    return json({ error: "Stored Trakt app credentials could not be decrypted." }, 500);
  }
}

async function rescheduleDevicePoll(
  db: import("./storage/d1.js").D1DatabaseLike,
  session: TraktDeviceSession,
  intervalSeconds: number,
  now: number
): Promise<TraktDeviceSession> {
  return upsertTraktDeviceSession(db, SELF_HOST_USER_ID, {
    deviceCodeCiphertext: session.deviceCodeCiphertext,
    userCode: session.userCode,
    verificationUrl: session.verificationUrl,
    expiresAt: session.expiresAt,
    intervalSeconds,
    nextPollAt: new Date(now + intervalSeconds * 1000).toISOString()
  });
}

function terminalTraktMessage(kind: "invalid" | "used" | "expired" | "denied"): string {
  if (kind === "denied") return "Trakt authorization was denied. Start a new link to try again.";
  if (kind === "expired") return "Trakt authorization expired. Start a new link.";
  if (kind === "used") return "This Trakt authorization was already used. Start a new link.";
  return "Trakt rejected the device authorization. Start a new link.";
}

function externalServiceError(error: unknown, fallback: string): Response {
  if (error instanceof TraktApiError && error.status === 429) return traktRateLimitResponse(error);
  const status = error instanceof TraktApiError && error.status >= 500 ? 502 : 500;
  return json({ error: error instanceof Error ? error.message : fallback }, status);
}

function syncErrorResponse(error: unknown, fallback: string, status: number): Response {
  if (error instanceof TraktApiError && error.status === 429) return traktRateLimitResponse(error);
  return json({ error: error instanceof Error ? error.message : fallback }, status);
}

function traktRateLimitResponse(error: TraktApiError): Response {
  const retryAfterSeconds = error.retryAfterSeconds;
  const message = retryAfterSeconds
    ? `Trakt rate limit reached. Retry in ${retryAfterSeconds} seconds.`
    : "Trakt rate limit reached. Try again later.";
  return json({ error: message, retryAfterSeconds }, 429);
}

function summarizeConnection(connection: ConnectionRecord | null) {
  return {
    stremio: {
      auth: connection?.stremioAuthCiphertext ? "configured" : "missing",
      userId: connection?.stremioUserId ? redactIdentifier(connection.stremioUserId) : null
    },
    traktApp: {
      clientId: connection?.traktClientIdCiphertext ? "configured" : "missing",
      clientSecret: connection?.traktClientSecretCiphertext ? "configured" : "missing",
      redirectUri: connection?.traktRedirectUri ? "configured" : "missing"
    },
    traktOAuth: {
      access: connection?.traktAccessCiphertext ? "configured" : "missing",
      refresh: connection?.traktRefreshCiphertext ? "configured" : "missing",
      expiresAt: connection?.traktExpiresAt ?? null,
      username: connection?.traktUsername ?? null
    },
    encryptionVersion: connection?.encryptionVersion ?? null
  };
}

function summarizeDeviceSession(session: TraktDeviceSession | null) {
  if (!session) return { state: "idle" };
  return {
    state: Date.parse(session.expiresAt) > Date.now() ? "awaiting-approval" : "expired",
    userCode: session.userCode,
    verificationUrl: session.verificationUrl,
    activationUrl: `${session.verificationUrl.replace(/\/$/, "")}/${encodeURIComponent(session.userCode)}`,
    expiresAt: session.expiresAt,
    intervalSeconds: session.intervalSeconds
  };
}

function secondsUntil(isoValue: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(isoValue) - now) / 1000));
}

function redactIdentifier(value: string): string {
  if (value.length <= 10) return "[redacted]";
  return `${value.slice(0, 4)}...[redacted]...${value.slice(-4)}`;
}

function parseHostedSyncSettings(value: unknown): HostedSyncSettings {
  const record = objectValue(value, "settings");
  const scope = stringValue(record.scope, "scope");
  if (scope !== "test" && scope !== "account-preview" && scope !== "account") {
    throw new Error("Unsupported settings scope.");
  }
  const historyMode = stringValue(record.historyMode, "historyMode");
  if (historyMode !== "union") throw new Error("Unsupported history mode.");
  const likeThreshold = intValue(record.likeThreshold, "likeThreshold");
  const loveThreshold = intValue(record.loveThreshold, "loveThreshold");
  if (likeThreshold < 1 || likeThreshold > 10 || loveThreshold < 1 || loveThreshold > 10 || likeThreshold >= loveThreshold) {
    throw new Error("Invalid rating thresholds.");
  }
  const syncIntervalMinutes = intValue(record.syncIntervalMinutes, "syncIntervalMinutes");
  if (syncIntervalMinutes !== 60) throw new Error("Only the hourly sync interval is supported.");

  return {
    scope,
    historyMode,
    watchedEnabled: boolValue(record.watchedEnabled, "watchedEnabled"),
    ratingSyncEnabled: boolValue(record.ratingSyncEnabled, "ratingSyncEnabled"),
    libraryWatchlistEnabled: boolValue(record.libraryWatchlistEnabled, "libraryWatchlistEnabled"),
    removalsEnabled: boolValue(record.removalsEnabled, "removalsEnabled"),
    likeThreshold,
    loveThreshold,
    syncIntervalMinutes,
    optionalCatalogsEnabled: boolValue(record.optionalCatalogsEnabled, "optionalCatalogsEnabled")
  };
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new Error(`${label} must be an object.`);
}

function stringValue(value: unknown, label: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`${label} must be a non-empty string.`);
}

function trimmedString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length < 8 || trimmed.length > 500) throw new Error(`${label} length is invalid.`);
  return trimmed;
}

function boundedSecret(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  if (value.length < 8 || value.length > 1000) throw new Error(`${label} length is invalid.`);
  return value;
}

function credentialPassword(value: unknown): string {
  if (typeof value !== "string") throw new Error("password must be a string.");
  if (value.length < 1 || value.length > 1000) throw new Error("password length is invalid.");
  return value;
}

function emailValue(value: unknown): string {
  if (typeof value !== "string") throw new Error("email must be a string.");
  const email = value.trim();
  if (email.length > 320 || !/^\S+@\S+\.\S+$/.test(email)) throw new Error("email is invalid.");
  return email;
}

function httpUrl(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error(`${label} must be an HTTP URL.`);
  return parsed.toString();
}

function boolValue(value: unknown, label: string): boolean {
  if (typeof value === "boolean") return value;
  throw new Error(`${label} must be a boolean.`);
}

function intValue(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  throw new Error(`${label} must be an integer.`);
}

function fingerprintValue(value: unknown): string {
  const fingerprint = stringValue(value, "fingerprint");
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error("Invalid preview fingerprint.");
  return fingerprint;
}

function configurePage(origin: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>SYNCIO</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; background: Canvas; color: CanvasText; }
    main { width: min(760px, calc(100vw - 32px)); margin: 64px auto; }
    h1 { margin: 0 0 8px; font-size: clamp(2.5rem, 8vw, 5rem); line-height: 0.95; letter-spacing: 0; }
    h2 { margin: 32px 0 12px; font-size: 1.2rem; }
    p, dd { color: color-mix(in srgb, CanvasText 68%, transparent); }
    code { display: block; padding: 12px; border: 1px solid color-mix(in srgb, CanvasText 24%, transparent); border-radius: 6px; overflow-wrap: anywhere; }
    dl { display: grid; grid-template-columns: minmax(120px, 180px) 1fr; gap: 8px 16px; margin: 16px 0; }
    dt { font-weight: 700; }
    dd { margin: 0; }
    form { display: grid; gap: 12px; margin-top: 16px; }
    label { display: grid; gap: 6px; font-weight: 700; }
    input { box-sizing: border-box; width: 100%; padding: 12px; border: 1px solid color-mix(in srgb, CanvasText 24%, transparent); border-radius: 6px; background: Canvas; color: CanvasText; font: inherit; }
    button, .button { display: inline-block; width: fit-content; padding: 11px 16px; border: 0; border-radius: 6px; background: #2dd4bf; color: #082f2a; font: inherit; font-weight: 700; cursor: pointer; text-decoration: none; }
    button:disabled { cursor: wait; opacity: 0.55; }
    a { color: #14b8a6; }
    .panel { padding: 16px 0; border-top: 1px solid color-mix(in srgb, CanvasText 22%, transparent); }
    .muted { color: color-mix(in srgb, CanvasText 58%, transparent); }
    .result { min-height: 1.5em; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .hidden { display: none; }
    .user-code { font-size: 1.6rem; font-weight: 800; letter-spacing: 0; }
    fieldset { border: 0; padding: 0; margin: 0; }
    .mode { display: flex; width: fit-content; border: 1px solid color-mix(in srgb, CanvasText 24%, transparent); border-radius: 6px; overflow: hidden; }
    .mode label { display: block; padding: 9px 12px; cursor: pointer; }
    .mode label + label { border-left: 1px solid color-mix(in srgb, CanvasText 24%, transparent); }
    .mode input { width: auto; margin-right: 6px; }
    .settings { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 20px; }
    .settings label { display: flex; align-items: center; gap: 8px; }
    .settings input[type="checkbox"] { width: auto; }
    .settings input[type="number"], .settings select { width: 100%; }
    pre { max-height: 480px; overflow: auto; padding: 12px; border: 1px solid color-mix(in srgb, CanvasText 24%, transparent); border-radius: 6px; white-space: pre-wrap; overflow-wrap: anywhere; }
    @media (max-width: 560px) { .settings { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <h1>SYNCIO</h1>
    <p>Self-hosted addon shell for deep Stremio and Trakt synchronization.</p>

    <section class="panel">
      <h2>Add-on Repository URL</h2>
      <code>${escapeHtml(`${origin}/manifest.json`)}</code>
    </section>

    <section class="panel" id="setup-access">
      <h2>Setup Access</h2>
      <form id="setup-access-form">
        <label>
          Setup Token
          <input name="setupToken" type="password" autocomplete="current-password" required>
        </label>
        <button type="submit">Unlock Setup</button>
      </form>
      <p><a href="https://github.com/giaaaacomo/SYNCIO/blob/main/docs/SELF_HOST_ONBOARDING.md#setup-token" target="_blank" rel="noreferrer">Forgot the token?</a></p>
      <p id="setup-access-result" class="result muted"></p>
    </section>

    <section class="panel protected hidden">
      <h2>Status</h2>
      <dl>
        <dt>Storage</dt><dd id="storage-status">Loading</dd>
        <dt>Encryption</dt><dd id="encryption-status">Loading</dd>
        <dt>Trakt app</dt><dd id="trakt-app-status">Loading</dd>
        <dt>Trakt OAuth</dt><dd id="trakt-oauth-status">Loading</dd>
        <dt>Stremio</dt><dd id="stremio-status">Loading</dd>
        <dt>Last sync</dt><dd id="last-sync-status">No runs yet</dd>
      </dl>
    </section>

    <section class="panel protected hidden">
      <h2>Trakt App</h2>
      <p>Create your own Trakt application, then save its credentials here. Values are encrypted before they are stored in your D1 database.</p>
      <p><a href="https://trakt.tv/oauth/applications/new" target="_blank" rel="noreferrer">Create Trakt API app</a></p>
      <form id="trakt-app-form">
        <label>
          Client ID
          <input name="clientId" autocomplete="off" required>
        </label>
        <label>
          Client Secret
          <input name="clientSecret" type="password" autocomplete="off" required>
        </label>
        <label>
          Redirect URI
          <input name="redirectUri" type="url" value="${escapeHtml(`${origin}/oauth/trakt/callback`)}" required>
        </label>
        <button type="submit">Save Trakt App</button>
      </form>
      <p id="trakt-app-result" class="result muted"></p>
    </section>

    <section class="panel protected hidden">
      <h2>Trakt Account</h2>
      <div class="actions">
        <button id="trakt-link-start" type="button">Link Trakt</button>
        <a id="trakt-activate" class="button hidden" target="_blank" rel="noreferrer">Open Trakt Approval</a>
        <button id="trakt-link-poll" class="hidden" type="button">Check Approval</button>
      </div>
      <p id="trakt-user-code" class="user-code hidden"></p>
      <p id="trakt-link-result" class="result muted"></p>
    </section>

    <section class="panel protected hidden">
      <h2>Stremio Account</h2>
      <form id="stremio-form">
        <fieldset class="mode">
          <label><input type="radio" name="mode" value="credentials" checked>Email</label>
          <label><input type="radio" name="mode" value="auth-key">Auth Key</label>
        </fieldset>
        <div id="stremio-credentials">
          <label>Email <input name="email" type="email" autocomplete="username"></label>
          <label>Password <input name="password" type="password" autocomplete="current-password"></label>
        </div>
        <div id="stremio-auth-key" class="hidden">
          <label>Auth Key <input name="authKey" type="password" autocomplete="off"></label>
        </div>
        <button type="submit">Link Stremio</button>
      </form>
      <p id="stremio-result" class="result muted"></p>
    </section>

    <section class="panel protected hidden">
      <h2>Sync Settings</h2>
      <form id="sync-settings-form">
        <div class="settings">
          <label><input name="watchedEnabled" type="checkbox"> Watched history</label>
          <label><input name="ratingSyncEnabled" type="checkbox"> Ratings</label>
          <label><input name="libraryWatchlistEnabled" type="checkbox"> Watchlist to Library</label>
          <label><input name="optionalCatalogsEnabled" type="checkbox"> Optional catalogs</label>
          <label>Mode
            <select name="scope">
              <option value="account-preview">Preview only</option>
              <option value="test">Test account</option>
              <option value="account" disabled>Live account (activate below)</option>
            </select>
          </label>
          <label>Interval
            <select name="syncIntervalMinutes">
              <option value="60">60 minutes</option>
            </select>
          </label>
          <label>Like threshold <input name="likeThreshold" type="number" min="1" max="9"></label>
          <label>Love threshold <input name="loveThreshold" type="number" min="2" max="10"></label>
        </div>
        <button type="submit">Save Settings</button>
      </form>
      <p id="sync-settings-result" class="result muted"></p>
    </section>

    <section class="panel protected hidden">
      <h2>Sync Preview</h2>
      <button id="sync-preview" type="button">Run Read-only Preview</button>
      <button id="sync-apply" class="hidden" type="button">Apply Preview</button>
      <div id="live-activation" class="hidden">
        <label>Live confirmation <input id="live-confirmation" autocomplete="off" placeholder="ENABLE SYNCIO"></label>
        <button id="sync-activate" type="button">Activate Live Sync</button>
      </div>
      <p id="sync-preview-result" class="result muted"></p>
      <pre id="sync-preview-output" class="hidden"></pre>
    </section>
  </main>
  <script>
    const byId = (id) => document.getElementById(id);
    const tokenKey = "syncio.setupToken";
    let setupToken = sessionStorage.getItem(tokenKey) || "";
    let pollTimer;
    let previewFingerprint = "";
    let currentScope = "account-preview";

    async function setupApi(path, options = {}) {
      const headers = new Headers(options.headers || {});
      headers.set("authorization", "Bearer " + setupToken);
      const response = await fetch(path, { ...options, headers });
      const responseText = await response.text();
      let body = {};
      try {
        body = responseText ? JSON.parse(responseText) : {};
      } catch {
        body = { error: responseText || "The server returned an invalid response." };
      }
      if (response.status === 401) lockSetup("Setup token rejected.");
      return { response, body };
    }

    function unlockSetup() {
      byId("setup-access").classList.add("hidden");
      document.querySelectorAll(".protected").forEach((element) => element.classList.remove("hidden"));
    }

    function lockSetup(message = "") {
      clearTimeout(pollTimer);
      sessionStorage.removeItem(tokenKey);
      setupToken = "";
      byId("setup-access").classList.remove("hidden");
      document.querySelectorAll(".protected").forEach((element) => element.classList.add("hidden"));
      byId("setup-access-result").textContent = message;
    }

    function showRateLimitCountdown(button, result, body) {
      let remaining = Number(body.retryAfterSeconds);
      if (!Number.isFinite(remaining) || remaining <= 0) return false;
      remaining = Math.ceil(remaining);
      button.disabled = true;
      const update = () => {
        if (remaining <= 0) {
          button.disabled = false;
          result.textContent = "Trakt is ready. Run the preview again.";
          return;
        }
        result.textContent = "Trakt rate limit reached. Retry available in " + remaining + " seconds.";
        remaining -= 1;
        setTimeout(update, 1000);
      };
      update();
      return true;
    }

    async function refreshStatus() {
      const { response, body } = await setupApi("/api/setup/status");
      if (!response.ok) throw new Error(body.error || "Status failed");
      const connections = body.connections || {};
      byId("storage-status").textContent = body.storage?.d1 + ", " + (body.storage?.reachable ? "reachable" : "not reachable");
      byId("encryption-status").textContent = body.encryption;
      byId("trakt-app-status").textContent =
        "client id " + connections.traktApp?.clientId + ", client secret " + connections.traktApp?.clientSecret +
        ", redirect URI " + connections.traktApp?.redirectUri;
      byId("trakt-oauth-status").textContent =
        "access " + connections.traktOAuth?.access + ", refresh " + connections.traktOAuth?.refresh +
        (connections.traktOAuth?.username ? ", account " + connections.traktOAuth.username : "");
      byId("stremio-status").textContent = "auth " + connections.stremio?.auth +
        (connections.stremio?.userId ? ", account " + connections.stremio.userId : "");
      const latestRun = body.latestRun;
      byId("last-sync-status").textContent = latestRun
        ? latestRun.status + ", " + latestRun.mode + ", " + latestRun.plannedChanges + " planned, " + latestRun.finishedAt
        : "No runs yet";
      renderAuthorization(body.traktDevice);
    }

    async function refreshSettings() {
      const { response, body } = await setupApi("/api/setup/settings");
      if (!response.ok) throw new Error(body.error || "Settings failed");
      const form = byId("sync-settings-form");
      for (const name of ["watchedEnabled", "ratingSyncEnabled", "libraryWatchlistEnabled", "optionalCatalogsEnabled"]) {
        form.elements[name].checked = Boolean(body[name]);
      }
      for (const name of ["scope", "syncIntervalMinutes", "likeThreshold", "loveThreshold"]) {
        form.elements[name].value = String(body[name]);
      }
      currentScope = String(body.scope || "account-preview");
      form.elements.scope.querySelector('option[value="account"]').disabled = currentScope !== "account";
    }

    function renderAuthorization(authorization) {
      const active = authorization?.state === "awaiting-approval";
      byId("trakt-activate").classList.toggle("hidden", !active);
      byId("trakt-link-poll").classList.toggle("hidden", !active);
      byId("trakt-user-code").classList.toggle("hidden", !active);
      if (!active) return;
      byId("trakt-activate").href = authorization.activationUrl;
      byId("trakt-user-code").textContent = authorization.userCode;
      byId("trakt-link-result").textContent = "Approve this code on Trakt. SYNCIO will check automatically.";
    }

    byId("setup-access-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      setupToken = String(new FormData(form).get("setupToken") || "");
      sessionStorage.setItem(tokenKey, setupToken);
      try {
        await Promise.all([refreshStatus(), refreshSettings()]);
        unlockSetup();
        form.reset();
      } catch (error) {
        lockSetup(error instanceof Error ? error.message : String(error));
      }
    });

    byId("trakt-app-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const result = byId("trakt-app-result");
      const payload = Object.fromEntries(new FormData(form).entries());
      result.textContent = "Saving";
      try {
        const { response, body } = await setupApi("/api/setup/trakt-app", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          result.textContent = body.error || "Save failed";
          return;
        }
        result.textContent = "Trakt app credentials saved locally.";
        form.reset();
        await refreshStatus();
      } catch (error) {
        result.textContent = error instanceof Error ? error.message : "Save failed";
      }
    });

    byId("trakt-link-start").addEventListener("click", async () => {
      clearTimeout(pollTimer);
      const result = byId("trakt-link-result");
      result.textContent = "Starting Trakt authorization";
      const { response, body } = await setupApi("/api/setup/trakt/start", { method: "POST" });
      if (!response.ok) {
        result.textContent = body.error || "Could not start Trakt authorization";
        return;
      }
      renderAuthorization(body.authorization);
      schedulePoll(body.authorization?.intervalSeconds || 5);
    });

    byId("trakt-link-poll").addEventListener("click", () => pollTraktLink());

    document.querySelectorAll('input[name="mode"]').forEach((input) => {
      input.addEventListener("change", () => {
        const authKeyMode = input.checked && input.value === "auth-key";
        if (!input.checked) return;
        byId("stremio-credentials").classList.toggle("hidden", authKeyMode);
        byId("stremio-auth-key").classList.toggle("hidden", !authKeyMode);
      });
    });

    byId("stremio-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const mode = String(data.get("mode"));
      const payload = mode === "auth-key"
        ? { mode, authKey: data.get("authKey") }
        : { mode, email: data.get("email"), password: data.get("password") };
      const result = byId("stremio-result");
      result.textContent = "Linking Stremio";
      const { response, body } = await setupApi("/api/setup/stremio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      form.reset();
      byId("stremio-credentials").classList.remove("hidden");
      byId("stremio-auth-key").classList.add("hidden");
      if (!response.ok) {
        result.textContent = body.error || "Stremio link failed";
        return;
      }
      result.textContent = "Stremio linked as " + (body.connections?.stremio?.userId || "verified account") + ".";
      await refreshStatus();
    });

    byId("sync-settings-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = {
        scope: form.elements.scope.value,
        historyMode: "union",
        watchedEnabled: form.elements.watchedEnabled.checked,
        ratingSyncEnabled: form.elements.ratingSyncEnabled.checked,
        libraryWatchlistEnabled: form.elements.libraryWatchlistEnabled.checked,
        removalsEnabled: false,
        likeThreshold: Number(form.elements.likeThreshold.value),
        loveThreshold: Number(form.elements.loveThreshold.value),
        syncIntervalMinutes: Number(form.elements.syncIntervalMinutes.value),
        optionalCatalogsEnabled: form.elements.optionalCatalogsEnabled.checked
      };
      const result = byId("sync-settings-result");
      result.textContent = "Saving";
      const { response, body } = await setupApi("/api/setup/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      result.textContent = response.ok ? "Settings saved." : (body.error || "Save failed");
      if (response.ok) {
        currentScope = String(body.scope || payload.scope);
        previewFingerprint = "";
        byId("sync-apply").classList.add("hidden");
        byId("live-activation").classList.add("hidden");
      }
    });

    byId("sync-preview").addEventListener("click", async () => {
      const result = byId("sync-preview-result");
      const output = byId("sync-preview-output");
      result.textContent = "Reading Stremio and Trakt";
      output.classList.add("hidden");
      const { response, body } = await setupApi("/api/sync/preview");
      if (!response.ok) {
        if (!showRateLimitCountdown(byId("sync-preview"), result, body)) {
          result.textContent = body.error || "Preview failed";
        }
        return;
      }
      const totalDifferences = body.operations.totalDifferences ?? body.operations.total;
      const deferred = body.operations.deferred || 0;
      result.textContent = totalDifferences + " differences found; " + body.operations.total +
        " in this batch" + (deferred ? ", " + deferred + " deferred" : "") + ". No writes applied.";
      output.textContent = JSON.stringify(body, null, 2);
      output.classList.remove("hidden");
      previewFingerprint = body.operations.fingerprint || "";
      byId("sync-apply").classList.toggle(
        "hidden",
        !previewFingerprint || body.operations.total === 0 || currentScope === "account-preview"
      );
      byId("live-activation").classList.toggle("hidden", !previewFingerprint || currentScope !== "account-preview");
    });

    byId("sync-apply").addEventListener("click", async () => {
      const label = currentScope === "account" ? "live linked accounts" : "test accounts";
      if (!previewFingerprint || !window.confirm("Apply exactly the current preview batch to the " + label + "?")) return;
      const result = byId("sync-preview-result");
      result.textContent = "Rechecking preview before apply";
      const { response, body } = await setupApi("/api/sync/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fingerprint: previewFingerprint })
      });
      if (!response.ok) {
        result.textContent = body.error || "Apply failed";
        return;
      }
      result.textContent = body.applied + " operations applied: " + body.stremioOperations +
        " to Stremio, " + body.traktOperations + " to Trakt.";
      previewFingerprint = "";
      byId("sync-apply").classList.add("hidden");
      await refreshStatus();
    });

    byId("sync-activate").addEventListener("click", async () => {
      const confirmation = byId("live-confirmation").value;
      const result = byId("sync-preview-result");
      if (!previewFingerprint || confirmation !== "ENABLE SYNCIO") {
        result.textContent = "Type ENABLE SYNCIO to activate live synchronization.";
        return;
      }
      if (!window.confirm("Apply this preview batch and enable hourly live synchronization?")) return;
      result.textContent = "Rechecking and applying the activation preview";
      const { response, body } = await setupApi("/api/sync/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fingerprint: previewFingerprint, confirmation })
      });
      if (!response.ok) {
        result.textContent = body.error || "Live sync activation failed";
        return;
      }
      result.textContent = "Live synchronization active. " + body.applied + " operations applied.";
      previewFingerprint = "";
      byId("live-confirmation").value = "";
      byId("live-activation").classList.add("hidden");
      byId("sync-apply").classList.add("hidden");
      await Promise.all([refreshSettings(), refreshStatus()]);
    });

    function schedulePoll(seconds) {
      clearTimeout(pollTimer);
      pollTimer = setTimeout(pollTraktLink, Math.max(1, seconds) * 1000);
    }

    async function pollTraktLink() {
      const result = byId("trakt-link-result");
      const { response, body } = await setupApi("/api/setup/trakt/poll", { method: "POST" });
      if (response.ok && body.state === "linked") {
        result.textContent = "Trakt linked as " + (body.connections?.traktOAuth?.username || "verified account") + ".";
        renderAuthorization(null);
        await refreshStatus();
        return;
      }
      if (response.status === 202 || response.status === 429) {
        result.textContent = response.status === 202 ? "Waiting for Trakt approval" : (body.error || "Waiting before the next check");
        schedulePoll(body.retryAfterSeconds || body.authorization?.intervalSeconds || 5);
        return;
      }
      result.textContent = body.error || "Trakt link failed";
      await refreshStatus();
    }

    if (setupToken) {
      Promise.all([refreshStatus(), refreshSettings()])
        .then(() => unlockSetup())
        .catch((error) => lockSetup(error instanceof Error ? error.message : String(error)));
    }
  </script>
</body>
</html>`;
}

function statusPoster(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
  <rect width="300" height="450" fill="#101418"/>
  <rect x="24" y="24" width="252" height="402" rx="18" fill="#17202a" stroke="#2dd4bf" stroke-width="6"/>
  <text x="150" y="184" text-anchor="middle" fill="#eef2f5" font-family="Arial, sans-serif" font-size="44" font-weight="700">SYNCIO</text>
  <text x="150" y="238" text-anchor="middle" fill="#7dd3fc" font-family="Arial, sans-serif" font-size="20">Self-hosted shell</text>
  <circle cx="150" cy="310" r="44" fill="#0f766e"/>
  <text x="150" y="324" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="54" font-weight="700">+</text>
</svg>`;
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

function json(value: unknown, status = 200): Response {
  return new Response(`${JSON.stringify(value, null, 2)}\n`, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...CORS_HEADERS
    }
  });
}

function svg(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "image/svg+xml; charset=utf-8" }
  });
}

function text(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" }
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
