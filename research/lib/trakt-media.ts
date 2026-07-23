import { ProbeAbort } from "./probe.js";

export interface TraktIds {
  imdb?: string;
  trakt?: number;
  slug?: string;
  tmdb?: number;
  tvdb?: number;
}

export interface TraktMovie {
  title: string;
  year?: number;
  ids: TraktIds;
}

export interface TraktShow {
  title: string;
  year?: number;
  ids: TraktIds;
}

export interface TraktEpisode {
  title?: string;
  season: number;
  number: number;
  ids: TraktIds;
}

export interface TraktWatchedMovie {
  movie: TraktMovie;
  watchedAt: string;
  plays?: number;
}

export interface TraktRatedMovie {
  movie: TraktMovie;
  ratedAt?: string;
  rating: number;
}

export interface TraktWatchlistMovie {
  movie: TraktMovie;
  listedAt?: string;
}

export interface TraktWatchedShow {
  show: TraktShow;
  watchedAt: string;
  plays?: number;
}

export interface TraktHistoryEpisode {
  watchedAt: string;
  action?: string;
  show: TraktShow;
  episode: TraktEpisode;
}

export function parseWatchedMovies(value: unknown): TraktWatchedMovie[] {
  if (!Array.isArray(value)) throw new ProbeAbort("FAIL", "Expected Trakt watched movies array.");
  return value.map(parseWatchedMovie).filter((item): item is TraktWatchedMovie => item !== null);
}

export function parseWatchedShows(value: unknown): TraktWatchedShow[] {
  if (!Array.isArray(value)) throw new ProbeAbort("FAIL", "Expected Trakt watched shows array.");
  return value.map(parseWatchedShow).filter((item): item is TraktWatchedShow => item !== null);
}

export function parseRatedMovies(value: unknown): TraktRatedMovie[] {
  if (!Array.isArray(value)) throw new ProbeAbort("FAIL", "Expected Trakt rated movies array.");
  return value.map(parseRatedMovie).filter((item): item is TraktRatedMovie => item !== null);
}

export function parseWatchlistMovies(value: unknown): TraktWatchlistMovie[] {
  if (!Array.isArray(value)) throw new ProbeAbort("FAIL", "Expected Trakt watchlist movies array.");
  return value.map(parseWatchlistMovie).filter((item): item is TraktWatchlistMovie => item !== null);
}

export function parseHistoryEpisodes(value: unknown): TraktHistoryEpisode[] {
  if (!Array.isArray(value)) throw new ProbeAbort("FAIL", "Expected Trakt episode history array.");
  return value.map(parseHistoryEpisode).filter((item): item is TraktHistoryEpisode => item !== null);
}

function parseWatchlistMovie(value: unknown): TraktWatchlistMovie | null {
  const item = record(value);
  const movie = parseMovie(item.movie);
  if (!movie) return null;
  const output: TraktWatchlistMovie = { movie };
  assignIfDefined(output, "listedAt", stringValue(item.listed_at));
  return output;
}

function parseRatedMovie(value: unknown): TraktRatedMovie | null {
  const item = record(value);
  const movie = parseMovie(item.movie);
  const rating = numberValue(item.rating);
  if (!movie || rating === undefined) return null;
  const output: TraktRatedMovie = { movie, rating };
  assignIfDefined(output, "ratedAt", stringValue(item.rated_at));
  return output;
}

function parseWatchedMovie(value: unknown): TraktWatchedMovie | null {
  const item = record(value);
  const movie = parseMovie(item.movie);
  const watchedAt = stringValue(item.last_watched_at);
  if (!movie || !watchedAt) return null;
  const output: TraktWatchedMovie = { movie, watchedAt };
  assignIfDefined(output, "plays", numberValue(item.plays));
  return output;
}

function parseWatchedShow(value: unknown): TraktWatchedShow | null {
  const item = record(value);
  const show = parseShow(item.show);
  const watchedAt = stringValue(item.last_watched_at);
  if (!show || !watchedAt) return null;
  const output: TraktWatchedShow = { show, watchedAt };
  assignIfDefined(output, "plays", numberValue(item.plays));
  return output;
}

function parseHistoryEpisode(value: unknown): TraktHistoryEpisode | null {
  const item = record(value);
  const show = parseShow(item.show);
  const episode = parseEpisode(item.episode);
  const watchedAt = stringValue(item.watched_at);
  if (!show || !episode || !watchedAt) return null;
  const output: TraktHistoryEpisode = { watchedAt, show, episode };
  assignIfDefined(output, "action", stringValue(item.action));
  return output;
}

function parseMovie(value: unknown): TraktMovie | null {
  const item = record(value);
  const title = stringValue(item.title);
  if (!title) return null;
  const output: TraktMovie = { title, ids: parseIds(item.ids) };
  assignIfDefined(output, "year", numberValue(item.year));
  return output;
}

function parseShow(value: unknown): TraktShow | null {
  const item = record(value);
  const title = stringValue(item.title);
  if (!title) return null;
  const output: TraktShow = { title, ids: parseIds(item.ids) };
  assignIfDefined(output, "year", numberValue(item.year));
  return output;
}

function parseEpisode(value: unknown): TraktEpisode | null {
  const item = record(value);
  const season = numberValue(item.season);
  const number = numberValue(item.number);
  if (season === undefined || number === undefined) return null;
  const output: TraktEpisode = { season, number, ids: parseIds(item.ids) };
  assignIfDefined(output, "title", stringValue(item.title));
  return output;
}

function parseIds(value: unknown): TraktIds {
  const item = record(value);
  const output: TraktIds = {};
  assignIfDefined(output, "imdb", stringValue(item.imdb));
  assignIfDefined(output, "trakt", numberValue(item.trakt));
  assignIfDefined(output, "slug", stringValue(item.slug));
  assignIfDefined(output, "tmdb", numberValue(item.tmdb));
  assignIfDefined(output, "tvdb", numberValue(item.tvdb));
  return output;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function assignIfDefined<Target extends object, Key extends keyof Target>(
  target: Target,
  key: Key,
  value: Target[Key] | undefined
): void {
  if (value !== undefined) target[key] = value;
}
