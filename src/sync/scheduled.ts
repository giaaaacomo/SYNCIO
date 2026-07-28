import type { D1DatabaseLike } from "../storage/d1.js";
import { finishSyncRun, startSyncRun } from "../storage/repositories/sync-runs.js";
import { getHostedSyncSettings, getLiveSyncActivation } from "../storage/repositories/users.js";
import { applyWorkerSyncFromPreview } from "./apply.js";
import { previewWorkerSync } from "./preview.js";
import { acquireSyncRunLease, releaseSyncRunLease } from "../storage/repositories/sync-run-lock.js";

export async function runScheduledSync(input: {
  db: D1DatabaseLike;
  userId: string;
  encryptionKey: string;
  fetcher: typeof fetch;
  traktApiBase?: string | undefined;
  stremioApiBase?: string | undefined;
  stremioTraktClientId?: string | undefined;
  stremioLikesBase?: string | undefined;
  cinemetaVideoIdsBase?: string | undefined;
  mode?: "scheduled" | "manual";
}): Promise<Record<string, unknown>> {
  const settings = await getHostedSyncSettings(input.db, input.userId);
  if (settings.scope === "account-preview") {
    return { ok: true, status: "skipped", reason: "Preview-only mode." };
  }
  if (settings.scope !== "test" && settings.scope !== "account") {
    return { ok: true, status: "skipped", reason: "Synchronization mode is not active." };
  }
  if (settings.scope === "account" && !await getLiveSyncActivation(input.db, input.userId)) {
    return { ok: true, status: "skipped", reason: "Live synchronization is not armed." };
  }

  const lease = await acquireSyncRunLease(input.db, input.userId);
  if (!lease) return { ok: true, status: "skipped", reason: "Another synchronization run is active." };
  try {
    const runId = await startSyncRun(input.db, input.userId, input.mode ?? "scheduled");
    let plannedChanges = 0;
    try {
      const preview = await previewWorkerSync(input);
      const operations = preview.operations as { total?: unknown; fingerprint?: unknown } | undefined;
      if (typeof operations?.total !== "number" || typeof operations.fingerprint !== "string") {
        throw new Error("Scheduled preview returned an invalid operation summary.");
      }
      plannedChanges = operations.total;
      const result = await applyWorkerSyncFromPreview(
        { ...input, expectedFingerprint: operations.fingerprint },
        preview
      );
      await finishSyncRun(input.db, runId, "succeeded", plannedChanges, null);
      return { ...result, status: "succeeded", runId, plannedChanges };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Scheduled sync failed.";
      await finishSyncRun(input.db, runId, "failed", plannedChanges, message);
      throw error;
    }
  } finally {
    await releaseSyncRunLease(input.db, lease);
  }
}
