export const DEFAULT_UPDATE_SOURCE_URL =
  "https://raw.githubusercontent.com/giaaaacomo/SYNCIO/main/package.json";

export const SYNCIO_REPOSITORY_URL = "https://github.com/giaaaacomo/SYNCIO";

export type UpdateState = "current" | "available" | "ahead" | "unavailable";

export interface UpdateStatus {
  state: UpdateState;
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  repositoryUrl: string;
  workflowFile: string;
  error?: string;
}

export async function readUpdateStatus(
  currentVersion: string,
  fetcher: typeof fetch = fetch,
  sourceUrl = DEFAULT_UPDATE_SOURCE_URL
): Promise<UpdateStatus> {
  try {
    const response = await fetcher(sourceUrl, {
      headers: { accept: "application/json" }
    });
    if (!response.ok) throw new Error(`Update source returned HTTP ${response.status}.`);

    const body = await response.json() as { version?: unknown };
    if (typeof body.version !== "string" || !parseSemver(body.version)) {
      throw new Error("Update source did not contain a valid version.");
    }
    if (!parseSemver(currentVersion)) throw new Error("Installed version is invalid.");

    const comparison = compareSemver(currentVersion, body.version);
    return {
      state: comparison < 0 ? "available" : comparison > 0 ? "ahead" : "current",
      currentVersion,
      latestVersion: body.version,
      updateAvailable: comparison < 0,
      repositoryUrl: SYNCIO_REPOSITORY_URL,
      workflowFile: "syncio-update.yml"
    };
  } catch (error) {
    return {
      state: "unavailable",
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      repositoryUrl: SYNCIO_REPOSITORY_URL,
      workflowFile: "syncio-update.yml",
      error: error instanceof Error ? error.message : "Update check failed."
    };
  }
}

export function compareSemver(left: string, right: string): number {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) throw new Error("Cannot compare invalid semantic versions.");

  for (let index = 0; index < 3; index += 1) {
    const difference = a.core[index]! - b.core[index]!;
    if (difference !== 0) return Math.sign(difference);
  }
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1;
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1;

  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const aPart = a.prerelease[index];
    const bPart = b.prerelease[index];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    if (aPart === bPart) continue;
    const aNumber = /^\d+$/.test(aPart) ? Number(aPart) : null;
    const bNumber = /^\d+$/.test(bPart) ? Number(bPart) : null;
    if (aNumber !== null && bNumber !== null) return Math.sign(aNumber - bNumber);
    if (aNumber !== null) return -1;
    if (bNumber !== null) return 1;
    return aPart < bPart ? -1 : 1;
  }
  return 0;
}

function parseSemver(value: string): { core: [number, number, number]; prerelease: string[] } | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : []
  };
}
