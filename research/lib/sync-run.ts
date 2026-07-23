import { applyRatingsImport, planRatingsImport, type RatingsImportOptions } from "./sync-ratings.js";
import { applyWatchedSync, planWatchedSync, type WatchedSyncOptions } from "./sync-watched.js";
import { applyWatchlistImport, planWatchlistImport, type WatchlistImportOptions } from "./sync-watchlist.js";

export interface SyncRunOptions {
  watched?: WatchedSyncOptions;
  ratings?: RatingsImportOptions;
  watchlist?: WatchlistImportOptions;
  include?: {
    watched?: boolean;
    ratings?: boolean;
    watchlist?: boolean;
  };
}

export interface SyncRunResult {
  mode: "preview" | "apply";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  include: {
    watched: boolean;
    ratings: boolean;
    watchlist: boolean;
  };
  summary: {
    plannedChanges: number;
    watched: number;
    ratings: number;
    watchlist: number;
  };
  results: {
    watched?: unknown;
    ratings?: unknown;
    watchlist?: unknown;
  };
}

export async function previewSyncRun(options: SyncRunOptions = {}): Promise<SyncRunResult> {
  return runSync("preview", options);
}

export async function applySyncRun(options: SyncRunOptions = {}): Promise<SyncRunResult> {
  return runSync("apply", options);
}

async function runSync(mode: SyncRunResult["mode"], options: SyncRunOptions): Promise<SyncRunResult> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const include = {
    watched: options.include?.watched ?? true,
    ratings: options.include?.ratings ?? true,
    watchlist: options.include?.watchlist ?? true
  };
  const results: SyncRunResult["results"] = {};

  if (include.watched) {
    results.watched = mode === "apply"
      ? await applyWatchedSync(options.watched)
      : await planWatchedSync(options.watched);
  }

  if (include.ratings) {
    results.ratings = mode === "apply"
      ? await applyRatingsImport(options.ratings)
      : await planRatingsImport(options.ratings);
  }

  if (include.watchlist) {
    results.watchlist = mode === "apply"
      ? await applyWatchlistImport(options.watchlist)
      : await planWatchlistImport(options.watchlist);
  }

  const finishedAtMs = Date.now();
  const planned = {
    watched: plannedWatchedChanges(results.watched),
    ratings: plannedRatingsChanges(results.ratings),
    watchlist: plannedWatchlistChanges(results.watchlist)
  };

  return {
    mode,
    startedAt,
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: finishedAtMs - startedAtMs,
    include,
    summary: {
      plannedChanges: planned.watched + planned.ratings + planned.watchlist,
      ...planned
    },
    results
  };
}

function plannedWatchedChanges(value: unknown): number {
  const root = record(value);
  return operationPlannedCount(root.traktToStremio) + operationPlannedCount(root.stremioToTrakt);
}

function operationPlannedCount(value: unknown): number {
  const operations = record(record(value).operations);
  return numberValue(operations.planned);
}

function plannedRatingsChanges(value: unknown): number {
  return numberValue(record(value).plannedChanges);
}

function plannedWatchlistChanges(value: unknown): number {
  return numberValue(record(record(value).stremio).plannedChanges);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
