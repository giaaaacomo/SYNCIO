import type { D1DatabaseLike } from "../storage/d1.js";
import {
  getActiveCompanionClientByTokenHash,
  touchCompanionClient,
  type CompanionClient,
  type CompanionScope
} from "../storage/repositories/companion-clients.js";

export interface CompanionAuthorizationFailure {
  ok: false;
  status: 401 | 403;
  error: string;
}

export async function authorizeCompanion(
  request: Request,
  db: D1DatabaseLike,
  requiredScope: CompanionScope
): Promise<{ ok: true; client: CompanionClient } | CompanionAuthorizationFailure> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return { ok: false, status: 401, error: "Companion authorization required." };

  const client = await getActiveCompanionClientByTokenHash(db, await hashCompanionSecret(token));
  if (!client) return { ok: false, status: 401, error: "Companion authorization required." };
  if (!client.scopes.includes(requiredScope)) {
    return { ok: false, status: 403, error: "Companion scope is not authorized." };
  }
  await touchCompanionClient(db, client.id);
  return { ok: true, client };
}

export async function hashCompanionSecret(value: string): Promise<string> {
  const input = new TextEncoder().encode(`syncio-companion:v1:${value}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
