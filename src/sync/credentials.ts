import { decryptSecret, encryptSecret } from "../crypto/secrets.js";
import {
  DEFAULT_STREMIO_TRAKT_CLIENT_ID,
  fetchStremioTraktAuthorization
} from "../stremio/account.js";
import type { D1DatabaseLike } from "../storage/d1.js";
import {
  getConnection,
  upsertConnection,
  type ConnectionRecord,
  type TraktAuthMode
} from "../storage/repositories/connections.js";
import { fetchTraktIdentity, refreshTraktToken } from "../trakt/device-oauth.js";

const REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;

export interface SyncCredentials {
  stremio: {
    authKey: string;
    userId: string;
  };
  trakt: {
    authMode: TraktAuthMode;
    clientId: string;
    accessToken: string;
    username: string;
    expiresAt: string;
  };
}

export interface SyncCredentialInput {
  db: D1DatabaseLike;
  userId: string;
  encryptionKey: string;
  fetcher: typeof fetch;
  traktApiBase?: string | undefined;
  stremioApiBase?: string | undefined;
  stremioTraktClientId?: string | undefined;
  now?: number;
}

export async function loadSyncCredentials(input: SyncCredentialInput): Promise<SyncCredentials> {
  const connection = await getConnection(input.db, input.userId);
  if (!connection) throw new Error("SYNCIO accounts are not configured.");
  if (!connection.stremioAuthCiphertext) throw new Error("SYNCIO connection field stremioAuth is missing.");
  if (!connection.stremioUserId) throw new Error("SYNCIO connection field stremioUserId is missing.");
  if (!connection.traktUsername) throw new Error("SYNCIO connection field traktUsername is missing.");

  const stremioAuth = await decryptSecret(
    connection.stremioAuthCiphertext,
    input.encryptionKey,
    `${input.userId}:stremio-auth`
  );
  if (connection.traktAuthMode === "stremio-delegated") {
    return loadDelegatedCredentials(input, connection, stremioAuth);
  }
  return loadDirectCredentials(input, connection, stremioAuth);
}

async function loadDelegatedCredentials(
  input: SyncCredentialInput,
  connection: ConnectionRecord,
  stremioAuth: string
): Promise<SyncCredentials> {
  const authorization = await fetchStremioTraktAuthorization(
    stremioAuth,
    input.fetcher,
    input.stremioApiBase,
    input.now ?? Date.now()
  );
  if (authorization.userId !== connection.stremioUserId) {
    throw new Error("Stremio account guard failed while loading delegated Trakt authorization.");
  }
  const clientId = (input.stremioTraktClientId ?? DEFAULT_STREMIO_TRAKT_CLIENT_ID).trim();
  if (!clientId) throw new Error("Stremio Trakt client id is not configured.");
  return credentialResult(
    stremioAuth,
    connection,
    "stremio-delegated",
    clientId,
    authorization.accessToken,
    authorization.expiresAt
  );
}

async function loadDirectCredentials(
  input: SyncCredentialInput,
  connection: ConnectionRecord,
  stremioAuth: string
): Promise<SyncCredentials> {
  const required = {
    traktClientId: connection.traktClientIdCiphertext,
    traktClientSecret: connection.traktClientSecretCiphertext,
    traktRedirectUri: connection.traktRedirectUri,
    traktAccess: connection.traktAccessCiphertext,
    traktRefresh: connection.traktRefreshCiphertext,
    traktExpiresAt: connection.traktExpiresAt
  };
  for (const [name, value] of Object.entries(required)) {
    if (!value) throw new Error(`SYNCIO connection field ${name} is missing.`);
  }

  const [clientId, clientSecret, accessToken, refreshToken] = await Promise.all([
    decryptSecret(required.traktClientId!, input.encryptionKey, `${input.userId}:trakt-client-id`),
    decryptSecret(required.traktClientSecret!, input.encryptionKey, `${input.userId}:trakt-client-secret`),
    decryptSecret(required.traktAccess!, input.encryptionKey, `${input.userId}:trakt-access`),
    decryptSecret(required.traktRefresh!, input.encryptionKey, `${input.userId}:trakt-refresh`)
  ]);
  const expiresAt = required.traktExpiresAt!;
  if (Date.parse(expiresAt) > (input.now ?? Date.now()) + REFRESH_MARGIN_MS) {
    return credentialResult(stremioAuth, connection, "direct-oauth", clientId, accessToken, expiresAt);
  }

  const refreshed = await refreshTraktToken(
    clientId,
    clientSecret,
    required.traktRedirectUri!,
    refreshToken,
    input.fetcher,
    input.traktApiBase
  );
  const identity = await fetchTraktIdentity(clientId, refreshed.accessToken, input.fetcher, input.traktApiBase);
  if (identity.username !== connection.traktUsername) {
    throw new Error("Refreshed Trakt token belongs to a different account.");
  }
  const [encryptedAccess, encryptedRefresh] = await Promise.all([
    encryptSecret(refreshed.accessToken, input.encryptionKey, `${input.userId}:trakt-access`),
    encryptSecret(refreshed.refreshToken, input.encryptionKey, `${input.userId}:trakt-refresh`)
  ]);
  const refreshedExpiresAt = new Date((refreshed.createdAt + refreshed.expiresIn) * 1000).toISOString();
  await upsertConnection(input.db, input.userId, {
    traktAccessCiphertext: encryptedAccess.value,
    traktRefreshCiphertext: encryptedRefresh.value,
    traktExpiresAt: refreshedExpiresAt,
    encryptionVersion: encryptedAccess.encryptionVersion
  });
  return credentialResult(
    stremioAuth,
    connection,
    "direct-oauth",
    clientId,
    refreshed.accessToken,
    refreshedExpiresAt
  );
}

function credentialResult(
  stremioAuth: string,
  connection: ConnectionRecord,
  authMode: TraktAuthMode,
  clientId: string,
  accessToken: string,
  expiresAt: string
): SyncCredentials {
  return {
    stremio: {
      authKey: stremioAuth,
      userId: connection.stremioUserId!
    },
    trakt: {
      authMode,
      clientId,
      accessToken,
      username: connection.traktUsername!,
      expiresAt
    }
  };
}
