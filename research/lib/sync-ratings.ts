import { getRatingStatus, resolveStremioAuthKey, sendRatingStatus, type StremioRatingStatus } from "./stremio.js";
import { parseRatedMovies } from "./trakt-media.js";
import { traktRequest } from "./trakt.js";

export interface RatingsImportOptions {
  movieIds?: string[];
  likeThreshold?: number;
  loveThreshold?: number;
}

export interface RatingPlan {
  mediaId: string;
  mediaType: "movie";
  title: string;
  traktRating: number;
  stremioStatus: StremioRatingStatus;
  currentStatus: StremioRatingStatus;
  status: "planned" | "target-skip";
}

export interface RatingsImportPlan {
  filters: { movieIds: string[] | "all" };
  ratedMovies: number;
  plannedChanges: number;
  targetSkipped: number;
  plans: RatingPlan[];
}

export interface RatingsImportApplyResult extends RatingsImportPlan {
  results: Array<{
    mediaId: string;
    status: StremioRatingStatus;
    result: unknown;
  }>;
}

export async function planRatingsImport(options: RatingsImportOptions = {}): Promise<RatingsImportPlan> {
  const movieFilter = idFilter(options.movieIds);
  const authKey = await resolveStremioAuthKey();
  const ratedMoviesPage = await traktRequest("/sync/ratings/movies");
  const ratedMovies = parseRatedMovies(ratedMoviesPage.body)
    .filter((item) => typeof item.movie.ids.imdb === "string")
    .filter((item) => matchesFilter(item.movie.ids.imdb, movieFilter));
  const candidates = ratedMovies.map((item) => ({
    mediaId: item.movie.ids.imdb,
    mediaType: "movie" as const,
    title: item.movie.title,
    traktRating: item.rating,
    stremioStatus: mapRating(item.rating, options)
  })).filter((item): item is Omit<RatingPlan, "currentStatus" | "status"> => item.mediaId !== undefined);
  const plans: RatingPlan[] = [];

  for (const candidate of candidates) {
    const currentStatus = parseStremioRatingStatus(await getRatingStatus(authKey, candidate.mediaId, candidate.mediaType));
    plans.push({
      ...candidate,
      currentStatus,
      status: currentStatus === candidate.stremioStatus ? "target-skip" : "planned"
    });
  }

  return summarizeRatingsImport(movieFilter, ratedMovies.length, plans);
}

export async function applyRatingsImport(options: RatingsImportOptions = {}): Promise<RatingsImportApplyResult> {
  const authKey = await resolveStremioAuthKey();
  const plan = await planRatingsImport(options);
  const changes = plan.plans.filter((item) => item.status === "planned");
  const results = [];
  for (const change of changes) {
    results.push({
      mediaId: change.mediaId,
      status: change.stremioStatus,
      result: await sendRatingStatus(authKey, change.mediaId, change.mediaType, change.stremioStatus)
    });
  }
  return { ...plan, results };
}

export function mapRating(rating: number, options: Pick<RatingsImportOptions, "likeThreshold" | "loveThreshold"> = {}): StremioRatingStatus {
  const likeThreshold = options.likeThreshold ?? 7;
  const loveThreshold = options.loveThreshold ?? 9;
  if (rating >= loveThreshold) return "loved";
  if (rating >= likeThreshold) return "liked";
  return null;
}

function summarizeRatingsImport(
  movieFilter: Set<string> | undefined,
  ratedMovies: number,
  plans: RatingPlan[]
): RatingsImportPlan {
  return {
    filters: { movieIds: movieFilter ? Array.from(movieFilter) : "all" },
    ratedMovies,
    plannedChanges: plans.filter((item) => item.status === "planned").length,
    targetSkipped: plans.filter((item) => item.status === "target-skip").length,
    plans
  };
}

function parseStremioRatingStatus(value: unknown): StremioRatingStatus {
  const status = value && typeof value === "object"
    ? (value as { status?: unknown }).status
    : undefined;
  if (status === "watched" || status === "liked" || status === "loved") return status;
  return null;
}

function idFilter(raw: string[] | undefined): Set<string> | undefined {
  if (!raw || raw.length === 0) return undefined;
  return new Set(raw.map((item) => item.trim()).filter(Boolean));
}

function matchesFilter(id: string | undefined, filterSet: Set<string> | undefined): boolean {
  if (!filterSet) return true;
  return id !== undefined && filterSet.has(id);
}
