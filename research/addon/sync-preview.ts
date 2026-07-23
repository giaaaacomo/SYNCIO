import { applyRatingsImport, planRatingsImport } from "../lib/sync-ratings.js";
import { buildSyncRunReview } from "../lib/sync-run-review.js";
import { assertTestScopeForApply, loadSyncSettings, syncRunOptionsFromSettings } from "../lib/sync-settings.js";
import { applySyncRun, previewSyncRun } from "../lib/sync-run.js";
import { applyWatchedSync, planWatchedSync } from "../lib/sync-watched.js";
import { applyWatchlistImport, planWatchlistImport } from "../lib/sync-watchlist.js";

export interface WatchedPreviewResult {
  status: number;
  body: unknown;
}

export async function previewFullSync(): Promise<WatchedPreviewResult> {
  const settings = await loadSyncSettings();
  const options = syncRunOptionsFromSettings(settings);
  const details = await previewSyncRun(options);
  return {
    status: 200,
    body: {
      command: "sync-run core preview",
      filters: options,
      review: buildSyncRunReview(details, settings.scope),
      details
    }
  };
}

export async function applyFullSync(): Promise<WatchedPreviewResult> {
  const settings = await loadSyncSettings();
  assertTestScopeForApply(settings);
  const options = syncRunOptionsFromSettings(settings);
  const details = await applySyncRun(options);
  return {
    status: 200,
    body: {
      command: "sync-run core apply",
      filters: options,
      review: buildSyncRunReview(details, settings.scope),
      details
    }
  };
}

export async function previewWatchedSync(): Promise<WatchedPreviewResult> {
  const options = await currentSyncRunOptions();
  return {
    status: 200,
    body: {
      command: "sync-watched core dry-run",
      filters: options.watched,
      details: await planWatchedSync(options.watched)
    }
  };
}

export async function applyWatchedSyncTest(): Promise<WatchedPreviewResult> {
  const options = await currentSyncRunOptions("apply");
  return {
    status: 200,
    body: {
      command: "sync-watched core apply",
      filters: options.watched,
      details: await applyWatchedSync(options.watched)
    }
  };
}

export async function previewRatingsSync(): Promise<WatchedPreviewResult> {
  const options = await currentSyncRunOptions();
  return {
    status: 200,
    body: {
      command: "trakt-to-stremio-ratings core dry-run",
      filters: options.ratings,
      details: await planRatingsImport(options.ratings)
    }
  };
}

export async function applyRatingsSync(): Promise<WatchedPreviewResult> {
  const options = await currentSyncRunOptions("apply");
  return {
    status: 200,
    body: {
      command: "trakt-to-stremio-ratings core apply",
      filters: options.ratings,
      details: await applyRatingsImport(options.ratings)
    }
  };
}

export async function previewWatchlistSync(): Promise<WatchedPreviewResult> {
  const options = await currentSyncRunOptions();
  return {
    status: 200,
    body: {
      command: "trakt-to-stremio-watchlist core dry-run",
      filters: options.watchlist,
      details: await planWatchlistImport(options.watchlist)
    }
  };
}

export async function applyWatchlistSync(): Promise<WatchedPreviewResult> {
  const options = await currentSyncRunOptions("apply");
  return {
    status: 200,
    body: {
      command: "trakt-to-stremio-watchlist core apply",
      filters: options.watchlist,
      details: await applyWatchlistImport(options.watchlist)
    }
  };
}

async function currentSyncRunOptions(mode: "preview" | "apply" = "preview") {
  const settings = await loadSyncSettings();
  if (mode === "apply") assertTestScopeForApply(settings);
  return syncRunOptionsFromSettings(settings);
}
