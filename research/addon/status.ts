import { existsSync, readFileSync } from "node:fs";
import { resolveStatePath } from "../lib/sync-state.js";

export interface AddonRuntimeStatus {
  accounts: {
    stremio: "configured" | "missing";
    trakt: "configured" | "missing";
  };
  sync: {
    mode: "development_shell";
    statePath: string;
    trackedOperations: number;
  };
}

export function readAddonRuntimeStatus(): AddonRuntimeStatus {
  const statePath = resolveStatePath();
  return {
    accounts: {
      stremio: process.env.STREMIO_AUTH_KEY ? "configured" : "missing",
      trakt: process.env.TRAKT_ACCESS_TOKEN ? "configured" : "missing"
    },
    sync: {
      mode: "development_shell",
      statePath,
      trackedOperations: countTrackedOperations(statePath)
    }
  };
}

function countTrackedOperations(path: string): number {
  if (!existsSync(path)) return 0;

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { operations?: unknown };
    if (!parsed.operations || typeof parsed.operations !== "object" || Array.isArray(parsed.operations)) return 0;
    return Object.keys(parsed.operations).length;
  } catch {
    return 0;
  }
}
