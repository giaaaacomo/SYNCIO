import { buildLibraryPresenceChange, findLibraryItem, isVisibleLibraryItem } from "./library-items.js";
import { getLibraryItems, putLibraryChanges, resolveStremioAuthKey, type StremioLibraryItem } from "./stremio.js";
import { parseWatchlistMovies } from "./trakt-media.js";
import { traktRequest } from "./trakt.js";

export interface WatchlistImportOptions {
  movieIds?: string[];
}

export interface WatchlistSkippedPlan {
  status: "target-skip";
  reason: string;
  id: string;
  title: string;
}

export interface WatchlistChangePlan {
  status: "planned";
  change: StremioLibraryItem;
}

export type WatchlistPlan = WatchlistSkippedPlan | WatchlistChangePlan;

export interface WatchlistImportPlan {
  filters: { movieIds: string[] | "all" };
  trakt: { watchlistMovies: number };
  stremio: {
    plannedChanges: number;
    targetSkipped: number;
    ids: string[];
  };
  plans: WatchlistPlan[];
}

export interface WatchlistImportApplyResult extends WatchlistImportPlan {
  result: unknown;
}

export async function planWatchlistImport(options: WatchlistImportOptions = {}): Promise<WatchlistImportPlan> {
  const movieFilter = idFilter(options.movieIds);
  const authKey = await resolveStremioAuthKey();
  const [watchlistPage, existingItems] = await Promise.all([
    traktRequest("/sync/watchlist/movies"),
    getLibraryItems(authKey)
  ]);
  const movies = parseWatchlistMovies(watchlistPage.body)
    .filter((item) => typeof item.movie.ids.imdb === "string")
    .filter((item) => matchesFilter(item.movie.ids.imdb, movieFilter));
  const plans: WatchlistPlan[] = [];

  for (const item of movies) {
    const imdb = item.movie.ids.imdb;
    if (!imdb) continue;
    const existing = findLibraryItem(existingItems, imdb);
    if (existing && isVisibleLibraryItem(existing)) {
      plans.push({
        status: "target-skip",
        reason: "already visible in Stremio",
        id: imdb,
        title: item.movie.title
      });
      continue;
    }
    plans.push({
      status: "planned",
      change: buildLibraryPresenceChange({
        existing,
        id: imdb,
        type: "movie",
        name: item.movie.title,
        year: item.movie.year,
        visible: true
      })
    });
  }

  return summarizeWatchlistImport(movieFilter, movies.length, plans);
}

export async function applyWatchlistImport(options: WatchlistImportOptions = {}): Promise<WatchlistImportApplyResult> {
  const authKey = await resolveStremioAuthKey();
  const plan = await planWatchlistImport(options);
  const changes = plan.plans
    .filter((item): item is WatchlistChangePlan => item.status === "planned")
    .map((item) => item.change);
  const result = changes.length > 0 ? await putLibraryChanges(authKey, changes) : { success: true };
  return { ...plan, result };
}

function summarizeWatchlistImport(
  movieFilter: Set<string> | undefined,
  movieCount: number,
  plans: WatchlistPlan[]
): WatchlistImportPlan {
  const changes = plans.filter((item): item is WatchlistChangePlan => item.status === "planned");
  return {
    filters: { movieIds: movieFilter ? Array.from(movieFilter) : "all" },
    trakt: { watchlistMovies: movieCount },
    stremio: {
      plannedChanges: changes.length,
      targetSkipped: plans.filter((item) => item.status === "target-skip").length,
      ids: changes.map((item) => item.change._id)
    },
    plans
  };
}

function idFilter(raw: string[] | undefined): Set<string> | undefined {
  if (!raw || raw.length === 0) return undefined;
  return new Set(raw.map((item) => item.trim()).filter(Boolean));
}

function matchesFilter(id: string | undefined, filterSet: Set<string> | undefined): boolean {
  if (!filterSet) return true;
  return id !== undefined && filterSet.has(id);
}
