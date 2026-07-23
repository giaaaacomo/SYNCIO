import { decryptSecret, encryptSecret } from "../crypto/secrets.js";
import type { D1DatabaseLike } from "../storage/d1.js";
import { getConnection, upsertConnection } from "../storage/repositories/connections.js";
import { fetchTraktIdentity, refreshTraktToken } from "../trakt/device-oauth.js";

const REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;

export interface SyncCredentials {
  stremio: {
    authKey: string;
    userId: string;
  };
  trakt: {
    clientId: string;
    clientSecret: string;
    accessToken: string;
    refreshToken: string;
    redirectUri: string;
    username: string;
    expiresAt: string;
  };
}

export async function loadSyncCredentials(input: {
  db: D1DatabaseLike;
  userId: string;
  encryptionKey: string;
  fetcher: typeof fetch;
  traktApiBase?: string | undefined;
  now?: number;
}): Promise<SyncCredentials> {
  const connection = await getConnection(input.db, input.userId);
  if (!connection) throw new Error("SYNCIO accounts are not configured.");
  const required = {
    stremioAuth: connection.stremioAuthCiphertext,
    stremioUserId: connection.stremioUserId,
    traktClientId: connection.traktClientIdCiphertext,
    traktClientSecret: connection.traktClientSecretCiphertext,
    traktRedirectUri: connection.traktRedirectUri,
    traktAccess: connection.traktAccessCiphertext,
    traktRefresh: connection.traktRefreshCiphertext,
    traktExpiresAt: connection.traktExpiresAt,
    traktUsername: connection.traktUsername
  };
  for (const [name, value] of Object.entries(required)) {
    if (!value) throw new Error(`SYNCIO connection field ${name} is missing.`);
  }

  const [stremioAuth, clientId, clientSecret, accessToken, refreshToken] = await Promise.all([
    decryptSecret(required.stremioAuth!, input.encryptionKey, `${input.userId}:stremio-auth`),
    decryptSecret(required.traktClientId!, input.encryptionKey, `${input.userId}:trakt-client-id`),
    decryptSecret(required.traktClientSecret!, input.encryptionKey, `${input.userId}:trakt-client-secret`),
    decryptSecret(required.traktAccess!, input.encryptionKey, `${input.userId}:trakt-access`),
    decryptSecret(required.traktRefresh!, input.encryptionKey, `${input.userId}:trakt-refresh`)
  ]);
  const expiresAt = required.traktExpiresAt!;
  if (Date.parse(expiresAt) > (input.now ?? Date.now()) + REFRESH_MARGIN_MS) {
    return credentialResult(stremioAuth, clientId, clientSecret, accessToken, refreshToken, required);
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
  if (identity.username !== required.traktUsername) {
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
    clientId,
    clientSecret,
    refreshed.accessToken,
    refreshed.refreshToken,
    { ...required, traktExpiresAt: refreshedExpiresAt }
  );
}

function credentialResult(
  stremioAuth: string,
  clientId: string,
  clientSecret: string,
  accessToken: string,
  refreshToken: string,
  required: Record<string, string | null>
): SyncCredentials {
  return {
    stremio: { authKey: stremioAuth, userId: required.stremioUserId! },
    trakt: {
      clientId,
      clientSecret,
      accessToken,
      refreshToken,
      redirectUri: required.traktRedirectUri!,
      username: required.traktUsername!,
      expiresAt: required.traktExpiresAt!
    }
  };
}
