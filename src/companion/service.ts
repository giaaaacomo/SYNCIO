import { hashCompanionSecret } from "../auth/companion-auth.js";
import type { D1DatabaseLike } from "../storage/d1.js";
import {
  consumeCompanionPairingSession,
  createCompanionClient,
  upsertCompanionPairingSession
} from "../storage/repositories/companion-clients.js";
import { ensureUser } from "../storage/repositories/users.js";

const PAIRING_LIFETIME_MS = 10 * 60 * 1000;

export interface CompanionPairingOffer {
  contractVersion: 1;
  code: string;
  expiresAt: string;
}

export interface CompanionPairingResult {
  contractVersion: 1;
  client: {
    id: string;
    label: string;
    scopes: string[];
  };
  token: string;
}

export async function createCompanionPairingOffer(
  db: D1DatabaseLike,
  userId: string,
  now = new Date()
): Promise<CompanionPairingOffer> {
  await ensureUser(db, userId, now.toISOString());
  const code = randomSecret(18);
  const expiresAt = new Date(now.getTime() + PAIRING_LIFETIME_MS).toISOString();
  await upsertCompanionPairingSession(
    db,
    userId,
    await hashCompanionSecret(code),
    expiresAt,
    now.toISOString()
  );
  return { contractVersion: 1, code, expiresAt };
}

export async function pairCompanion(
  db: D1DatabaseLike,
  userId: string,
  input: unknown,
  now = new Date()
): Promise<CompanionPairingResult> {
  const body = recordValue(input, "body");
  assertOnlyKeys(body, new Set(["code", "label"]), "body");
  const code = constrainedString(body.code, "code", 16, 200);
  const label = constrainedString(body.label, "label", 2, 80);
  const consumed = await consumeCompanionPairingSession(
    db,
    userId,
    await hashCompanionSecret(code),
    now.toISOString()
  );
  if (!consumed) throw new CompanionPairingError("Pairing code is invalid or expired.");

  const token = randomSecret(32);
  const client = await createCompanionClient(db, {
    id: crypto.randomUUID(),
    userId,
    tokenHash: await hashCompanionSecret(token),
    label
  }, now.toISOString());
  return {
    contractVersion: 1,
    client: {
      id: client.id,
      label: client.label,
      scopes: client.scopes
    },
    token
  };
}

export class CompanionPairingError extends Error {}

function randomSecret(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: Set<string>, label: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new Error(`${label} contains unsupported fields: ${unexpected.join(", ")}.`);
  }
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function constrainedString(value: unknown, label: string, minimum: number, maximum: number): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  const result = value.trim();
  if (result.length < minimum || result.length > maximum) throw new Error(`${label} is invalid.`);
  return result;
}
