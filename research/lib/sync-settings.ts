import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { env, ProbeAbort } from "./probe.js";
import type { SyncRunOptions } from "./sync-run.js";
import { TEST_SYNC_OPTIONS } from "./test-sync-options.js";

export interface SyncSettings {
  version: 1;
  scope: "test" | "account-preview";
  enabled: {
    watched: boolean;
    ratings: boolean;
    watchlist: boolean;
  };
  ratings: {
    likeThreshold: number;
    loveThreshold: number;
  };
}

export function defaultSyncSettings(): SyncSettings {
  return {
    version: 1,
    scope: "test",
    enabled: {
      watched: true,
      ratings: true,
      watchlist: true
    },
    ratings: {
      likeThreshold: 7,
      loveThreshold: 9
    }
  };
}

export function resolveSettingsPath(raw?: string): string {
  return raw ?? env("SYNCIO_SETTINGS_PATH") ?? ".syncio/settings.json";
}

export async function loadSyncSettings(path = resolveSettingsPath()): Promise<SyncSettings> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return defaultSyncSettings();
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new ProbeAbort("FAIL", `Sync settings at ${path} are not valid JSON.`);
  }

  return parseSyncSettings(parsed, path);
}

export async function saveSyncSettings(settings: SyncSettings, path = resolveSettingsPath()): Promise<void> {
  const normalized = parseSyncSettings(settings, path);
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

export function syncRunOptionsFromSettings(settings: SyncSettings): SyncRunOptions {
  const scopedOptions = settings.scope === "test"
    ? TEST_SYNC_OPTIONS
    : {};
  return {
    ...scopedOptions,
    watched: {
      ...scopedOptions.watched
    },
    ratings: {
      ...scopedOptions.ratings,
      likeThreshold: settings.ratings.likeThreshold,
      loveThreshold: settings.ratings.loveThreshold
    },
    watchlist: {
      ...scopedOptions.watchlist
    },
    include: settings.enabled
  };
}

export function assertTestScopeForApply(settings: SyncSettings): void {
  if (settings.scope === "test") return;
  throw new ProbeAbort("FAIL", "Apply is disabled outside test scope. Switch back to test scope or run account-wide preview only.");
}

export function parseSyncSettings(value: unknown, path = "sync settings"): SyncSettings {
  if (!value || typeof value !== "object") {
    throw new ProbeAbort("FAIL", `Sync settings at ${path} must be an object.`);
  }

  const record = value as Record<string, unknown>;
  if (record.version !== 1) {
    throw new ProbeAbort("FAIL", `Sync settings at ${path} have unsupported version.`);
  }
  if (record.scope !== "test" && record.scope !== "account-preview") {
    throw new ProbeAbort("FAIL", `Sync settings at ${path} must use test or account-preview scope.`);
  }

  const enabled = objectValue(record.enabled, "enabled", path);
  const ratings = objectValue(record.ratings, "ratings", path);
  const likeThreshold = thresholdValue(ratings.likeThreshold, "likeThreshold", path);
  const loveThreshold = thresholdValue(ratings.loveThreshold, "loveThreshold", path);
  if (likeThreshold >= loveThreshold) {
    throw new ProbeAbort("FAIL", `Sync settings at ${path} require likeThreshold to be lower than loveThreshold.`);
  }

  return {
    version: 1,
    scope: record.scope,
    enabled: {
      watched: booleanValue(enabled.watched, "enabled.watched", path),
      ratings: booleanValue(enabled.ratings, "enabled.ratings", path),
      watchlist: booleanValue(enabled.watchlist, "enabled.watchlist", path)
    },
    ratings: {
      likeThreshold,
      loveThreshold
    }
  };
}

function objectValue(value: unknown, key: string, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProbeAbort("FAIL", `Sync settings ${key} at ${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function booleanValue(value: unknown, key: string, path: string): boolean {
  if (typeof value === "boolean") return value;
  throw new ProbeAbort("FAIL", `Sync settings ${key} at ${path} must be a boolean.`);
}

function thresholdValue(value: unknown, key: string, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 10) {
    throw new ProbeAbort("FAIL", `Sync settings ${key} at ${path} must be an integer from 1 to 10.`);
  }
  return value;
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT");
}
