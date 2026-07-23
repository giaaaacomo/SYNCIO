import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { env, ProbeAbort } from "./probe.js";

export interface SyncOperationRecord {
  key: string;
  firstAppliedAt: string;
  lastAppliedAt: string;
  appliedCount: number;
  direction: string;
  kind: string;
  summary: string;
}

export interface SyncioState {
  version: 1;
  operations: Record<string, SyncOperationRecord>;
}

export function resolveStatePath(raw?: string): string {
  return raw ?? env("SYNCIO_STATE_PATH") ?? ".syncio/state.json";
}

export async function loadSyncState(path: string): Promise<SyncioState> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return emptyState();
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new ProbeAbort("FAIL", `Sync state at ${path} is not valid JSON.`);
  }

  return parseState(parsed, path);
}

export async function saveSyncState(path: string, state: SyncioState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

export function hasAppliedOperation(state: SyncioState, key: string): boolean {
  return state.operations[key] !== undefined;
}

export function markAppliedOperation(
  state: SyncioState,
  input: { key: string; direction: string; kind: string; summary: string },
  appliedAt = new Date().toISOString()
): void {
  const existing = state.operations[input.key];
  state.operations[input.key] = {
    key: input.key,
    firstAppliedAt: existing?.firstAppliedAt ?? appliedAt,
    lastAppliedAt: appliedAt,
    appliedCount: (existing?.appliedCount ?? 0) + 1,
    direction: input.direction,
    kind: input.kind,
    summary: input.summary
  };
}

export function watchedMovieKey(direction: string, imdb: string, watchedAt: string | undefined): string {
  return ["watched", direction, "movie", imdb, watchedAt ?? "unknown"].join(":");
}

export function watchedEpisodeKey(
  direction: string,
  showImdb: string,
  season: number,
  episode: number,
  watchedAt: string | undefined
): string {
  return ["watched", direction, "episode", showImdb, season, episode, watchedAt ?? "unknown"].join(":");
}

function emptyState(): SyncioState {
  return { version: 1, operations: {} };
}

function parseState(value: unknown, path: string): SyncioState {
  if (!value || typeof value !== "object") {
    throw new ProbeAbort("FAIL", `Sync state at ${path} must be an object.`);
  }

  const record = value as Record<string, unknown>;
  if (record.version !== 1) {
    throw new ProbeAbort("FAIL", `Sync state at ${path} has unsupported version.`);
  }

  const operationsValue = record.operations;
  if (!operationsValue || typeof operationsValue !== "object" || Array.isArray(operationsValue)) {
    throw new ProbeAbort("FAIL", `Sync state at ${path} must include an operations object.`);
  }

  const operations: Record<string, SyncOperationRecord> = {};
  for (const [key, rawOperation] of Object.entries(operationsValue as Record<string, unknown>)) {
    const operation = parseOperation(key, rawOperation, path);
    operations[key] = operation;
  }

  return { version: 1, operations };
}

function parseOperation(key: string, value: unknown, path: string): SyncOperationRecord {
  if (!value || typeof value !== "object") {
    throw new ProbeAbort("FAIL", `Sync state operation ${key} at ${path} must be an object.`);
  }

  const record = value as Record<string, unknown>;
  const firstAppliedAt = stringValue(record.firstAppliedAt);
  const lastAppliedAt = stringValue(record.lastAppliedAt);
  const appliedCount = numberValue(record.appliedCount);
  const direction = stringValue(record.direction);
  const kind = stringValue(record.kind);
  const summary = stringValue(record.summary);
  if (!firstAppliedAt || !lastAppliedAt || appliedCount === undefined || !direction || !kind || !summary) {
    throw new ProbeAbort("FAIL", `Sync state operation ${key} at ${path} is incomplete.`);
  }

  return { key, firstAppliedAt, lastAppliedAt, appliedCount, direction, kind, summary };
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
