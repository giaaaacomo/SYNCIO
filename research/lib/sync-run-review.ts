import type { SyncRunResult } from "./sync-run.js";

export interface SyncRunReview {
  headline: string;
  summary: SyncRunResult["summary"];
  sections: Array<{
    title: string;
    lines: string[];
  }>;
  warnings: string[];
}

export function buildSyncRunReview(result: SyncRunResult, scope: string): SyncRunReview {
  const warnings = [
    "Visible Stremio Library membership is preserved when watched state changes.",
    "Removals are disabled by default."
  ];
  if (scope !== "test") {
    warnings.push("Apply is disabled in account-preview scope.");
  }

  return {
    headline: `${result.summary.plannedChanges} planned change${result.summary.plannedChanges === 1 ? "" : "s"}`,
    summary: result.summary,
    sections: [
      watchedSection(result.results.watched),
      ratingsSection(result.results.ratings),
      watchlistSection(result.results.watchlist)
    ].filter((section) => section.lines.length > 0),
    warnings
  };
}

function watchedSection(value: unknown): SyncRunReview["sections"][number] {
  const root = record(value);
  const operations = [
    ...operationItems(root.traktToStremio),
    ...operationItems(root.stremioToTrakt)
  ];
  const planned = operations.filter((item) => item.status === "planned");
  const targetSkipped = operations.filter((item) => item.status === "target-skip").length;
  const stateSkipped = operations.filter((item) => item.status === "state-skip").length;
  const movieCount = planned.filter((item) => item.kind === "movie").length;
  const stremioItems = plannedStremioItems(root.traktToStremio);
  const itemNames = new Map(stremioItems.map((item) => [item.id, item.name ?? item.id]));
  const showGroups = planned
    .filter((item) => item.kind === "episode")
    .map((item) => parseEpisodeSummary(item.summary))
    .filter((item): item is { showId: string; season: number; episode: number } => item !== null)
    .reduce((groups, item) => {
      const group = groups.get(item.showId) ?? { showId: item.showId, episodes: [] as string[] };
      group.episodes.push(`S${item.season}E${item.episode}`);
      groups.set(item.showId, group);
      return groups;
    }, new Map<string, { showId: string; episodes: string[] }>());
  const lines = [
    `${planned.length} planned watched operation${planned.length === 1 ? "" : "s"}; ${targetSkipped} already matched; ${stateSkipped} skipped by local ledger.`
  ];
  if (movieCount > 0) lines.push(`${movieCount} movie watched state${movieCount === 1 ? "" : "s"} would be updated.`);
  for (const group of showGroups.values()) {
    const label = itemNames.get(group.showId) ?? group.showId;
    lines.push(`${label}: ${group.episodes.length} episode${group.episodes.length === 1 ? "" : "s"} (${group.episodes.slice(0, 12).join(", ")}${group.episodes.length > 12 ? ", ..." : ""}).`);
  }
  for (const item of stremioItems) {
    const label = item.name ?? item.id;
    if (item.visibleLibraryItem) {
      lines.push(`${label}: visible Library membership would be preserved.`);
    } else if (item.historyOnly) {
      lines.push(`${label}: watched state would be written as history-only, not visible Library.`);
    }
  }
  return { title: "Watched", lines };
}

function ratingsSection(value: unknown): SyncRunReview["sections"][number] {
  const root = record(value);
  if (Object.keys(root).length === 0) return { title: "Ratings", lines: [] };
  const planned = arrayValue(root.plans).filter((item) => record(item).status === "planned");
  const targetSkipped = numberValue(root.targetSkipped);
  return {
    title: "Ratings",
    lines: [
      `${numberValue(root.plannedChanges)} planned rating change${numberValue(root.plannedChanges) === 1 ? "" : "s"}; ${targetSkipped} already matched.`,
      ...planned.map((item) => {
        const plan = record(item);
        return `${stringValue(plan.title) ?? stringValue(plan.mediaId) ?? "Unknown"}: Trakt ${numberValue(plan.traktRating)}/10 -> Stremio ${stringValue(plan.stremioStatus) ?? "clear"}.`;
      })
    ]
  };
}

function watchlistSection(value: unknown): SyncRunReview["sections"][number] {
  const root = record(value);
  if (Object.keys(root).length === 0) return { title: "Watchlist", lines: [] };
  const stremio = record(root.stremio);
  const planned = arrayValue(root.plans).filter((item) => record(item).status === "planned");
  const lines = [
    `${numberValue(stremio.plannedChanges)} planned Library addition${numberValue(stremio.plannedChanges) === 1 ? "" : "s"}; ${numberValue(stremio.targetSkipped)} already visible.`
  ];
  for (const item of planned) {
    const change = record(record(item).change);
    lines.push(`${stringValue(change.name) ?? stringValue(change._id) ?? "Unknown"} would be added as visible Library item.`);
  }
  return { title: "Watchlist", lines };
}

function operationItems(value: unknown): Array<{ kind?: unknown; status?: unknown; summary?: unknown }> {
  return arrayValue(record(record(value).operations).items).map((item) => record(item));
}

function plannedStremioItems(value: unknown): Array<{
  id: string;
  name?: string;
  visibleLibraryItem: boolean;
  historyOnly: boolean;
}> {
  return arrayValue(record(value).plannedStremioItems).map((item) => {
    const entry = record(item);
    const output: {
      id: string;
      name?: string;
      visibleLibraryItem: boolean;
      historyOnly: boolean;
    } = {
      id: stringValue(entry.id) ?? "unknown",
      visibleLibraryItem: entry.visibleLibraryItem === true,
      historyOnly: entry.historyOnly === true
    };
    const name = stringValue(entry.name);
    if (name) output.name = name;
    return output;
  });
}

function parseEpisodeSummary(summary: unknown): { showId: string; season: number; episode: number } | null {
  if (typeof summary !== "string") return null;
  const match = /^episode (tt\d+) S(\d+)E(\d+)$/.exec(summary);
  if (!match) return null;
  return {
    showId: match[1] ?? "",
    season: Number.parseInt(match[2] ?? "", 10),
    episode: Number.parseInt(match[3] ?? "", 10)
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
