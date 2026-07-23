import type { D1DatabaseLike } from "../storage/d1.js";
import { finishSyncRun, startSyncRun } from "../storage/repositories/sync-runs.js";
import { getHostedSyncSettings } from "../storage/repositories/users.js";
import { applyWorkerSync } from "./apply.js";
import { previewWorkerSync } from "./preview.js";

export async function runScheduledSync(input: {
  db: D1DatabaseLike;
  userId: string;
  encryptionKey: string;
  fetcher: typeof fetch;
  traktApiBase?: string | undefined;
  stremioApiBase?: string | undefined;
  stremioLikesBase?: string | undefined;
  cinemetaVideoIdsBase?: string | undefined;
  mode?: "scheduled" | "manual";
}): Promise<Record<string, unknown>> {
  const settings = await getHostedSyncSettings(input.db, input.userId);
  if (settings.scope === "account-preview") {
    return { ok: true, status: "skipped", reason: "Preview-only mode." };
  }
  if (settings.scope !== "test") {
    return { ok: true, status: "skipped", reason: "Live-account scheduling is not enabled yet." };
  }

  const runId = await startSyncRun(input.db, input.userId, input.mode ?? "scheduled");
  let plannedChanges = 0;
  try {
    const preview = await previewWorkerSync(input);
    const operations = preview.operations as { total?: unknown; fingerprint?: unknown } | undefined;
    if (typeof operations?.total !== "number" || typeof operations.fingerprint !== "string") {
      throw new Error("Scheduled preview returned an invalid operation summary.");
    }
    plannedChanges = operations.total;
    const result = await applyWorkerSync({ ...input, expectedFingerprint: operations.fingerprint });
    await finishSyncRun(input.db, runId, "succeeded", plannedChanges, null);
    return { ...result, status: "succeeded", runId, plannedChanges };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scheduled sync failed.";
    await finishSyncRun(input.db, runId, "failed", plannedChanges, message);
    throw error;
  }
}
