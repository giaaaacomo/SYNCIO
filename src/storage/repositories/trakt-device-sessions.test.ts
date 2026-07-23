import test from "node:test";
import assert from "node:assert/strict";
import {
  deleteTraktDeviceSession,
  getTraktDeviceSession,
  upsertTraktDeviceSession
} from "./trakt-device-sessions.js";
import type { D1DatabaseLike } from "../d1.js";

test("persists, reschedules, and deletes a Trakt device session", async () => {
  const db = new MemoryD1();
  const initial = await upsertTraktDeviceSession(db, "self-host", {
    deviceCodeCiphertext: "v1.iv.device",
    userCode: "ABC12345",
    verificationUrl: "https://trakt.tv/activate",
    expiresAt: "2026-07-23T00:10:00.000Z",
    intervalSeconds: 5,
    nextPollAt: "2026-07-23T00:00:05.000Z"
  }, "2026-07-23T00:00:00.000Z");

  const updated = await upsertTraktDeviceSession(db, "self-host", {
    ...initial,
    intervalSeconds: 10,
    nextPollAt: "2026-07-23T00:00:15.000Z"
  }, "2026-07-23T00:00:05.000Z");
  assert.equal(updated.intervalSeconds, 10);
  assert.equal(updated.createdAt, initial.createdAt);

  await deleteTraktDeviceSession(db, "self-host");
  assert.equal(await getTraktDeviceSession(db, "self-host"), null);
});

class MemoryD1 implements D1DatabaseLike {
  readonly sessions = new Map<string, Record<string, unknown>>();

  prepare(query: string) {
    let bound: unknown[] = [];
    const self = this;
    return {
      bind(...values: unknown[]) { bound = values; return this; },
      async first<T>() {
        return (self.sessions.get(String(bound[0])) ?? null) as T | null;
      },
      async run() {
        if (query.startsWith("INSERT INTO trakt_device_sessions")) {
          const userId = String(bound[0]);
          const existing = self.sessions.get(userId);
          self.sessions.set(userId, {
            user_id: userId,
            device_code_ciphertext: bound[1],
            user_code: bound[2],
            verification_url: bound[3],
            expires_at: bound[4],
            interval_seconds: bound[5],
            next_poll_at: bound[6],
            created_at: existing?.created_at ?? bound[7],
            updated_at: bound[8]
          });
        } else if (query.startsWith("DELETE FROM trakt_device_sessions")) {
          self.sessions.delete(String(bound[0]));
        }
        return { success: true };
      }
    };
  }
}
