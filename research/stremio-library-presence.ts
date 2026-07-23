import { buildLibraryPresenceChange, findLibraryItem, isVisibleLibraryItem } from "./lib/library-items.js";
import { boolFlag, flag, requireFlag, runProbe } from "./lib/probe.js";
import { getLibraryItems, putLibraryChanges, resolveStremioAuthKey, type StremioMediaType } from "./lib/stremio.js";

await runProbe("stremio-library-presence", async (args) => {
  const apply = boolFlag(args, "apply");
  const id = requireFlag(args, "media-id");
  const name = requireFlag(args, "name");
  const type = parsePresenceType(flag(args, "media-type") ?? "movie");
  const visible = parseVisible(flag(args, "visible") ?? "true");
  const year = parseOptionalYear(flag(args, "year"));
  const authKey = await resolveStremioAuthKey();
  const existingItems = await getLibraryItems(authKey);
  const existing = findLibraryItem(existingItems, id);
  const change = buildLibraryPresenceChange({ existing, id, type, name, year, visible });
  const alreadyMatches = existing ? isVisibleLibraryItem(existing) === visible : false;

  if (!apply) {
    return {
      status: "PASS",
      message: "Dry-run complete. Re-run with --apply to write this Stremio library presence state.",
      details: {
        id,
        type,
        visible,
        alreadyMatches,
        plannedChange: change
      }
    };
  }

  const result = alreadyMatches ? { success: true, skipped: "already matches" } : await putLibraryChanges(authKey, [change]);
  return {
    status: "PASS",
    message: "Applied Stremio library presence state.",
    details: { id, type, visible, alreadyMatches, result }
  };
});

function parsePresenceType(value: string): StremioMediaType {
  if (value === "movie" || value === "series") return value;
  throw new Error("media-type must be movie or series.");
}

function parseVisible(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("visible must be true or false.");
}

function parseOptionalYear(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
