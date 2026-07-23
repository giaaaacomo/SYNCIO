import type { StremioLibraryItem, StremioLibraryState } from "./stremio.js";

export interface WatchedMovieInput {
  existing: StremioLibraryItem | undefined;
  id: string;
  name: string;
  year: number | undefined;
  watchedAt: string;
  historyOnly: boolean;
  undo: boolean;
}

export interface LibraryPresenceInput {
  existing: StremioLibraryItem | undefined;
  id: string;
  type: "movie" | "series";
  name: string;
  year: number | undefined;
  visible: boolean;
}

export interface WatchedEpisodeInput extends WatchedMovieInput {
  watchedField: string | null;
  videoId: string;
  season: number;
  episode: number;
  seriesFlagged: boolean;
}

export function findLibraryItem(
  items: StremioLibraryItem[],
  id: string
): StremioLibraryItem | undefined {
  return items.find((item) => item._id === id);
}

export function isVisibleLibraryItem(item: StremioLibraryItem): boolean {
  return item.removed === false && item.temp === false;
}

export function isHistoryOnlyLibraryItem(item: StremioLibraryItem): boolean {
  return item.removed === true && item.temp === true;
}

export function buildMovieWatchedChange(input: WatchedMovieInput): StremioLibraryItem {
  const item = cloneOrCreate(input.existing, input.id, "movie", input.name, input.year, input.historyOnly);
  item.state = watchedState(item.state, input.id, input.watchedAt, input.undo);
  item._mtime = new Date().toISOString();
  return item;
}

export function buildLibraryPresenceChange(input: LibraryPresenceInput): StremioLibraryItem {
  const item = cloneOrCreate(input.existing, input.id, input.type, input.name, input.year, !input.visible);
  item.name = input.name;
  item.type = input.type;
  item.removed = !input.visible;
  item.temp = !input.visible;
  item.posterShape = item.posterShape ?? "poster";
  item.state = structuredClone(item.state ?? {});
  item.state.noNotif = false;
  if (input.year !== undefined) item.year = input.year;
  if (input.id.startsWith("tt")) item.poster = item.poster ?? `https://images.metahub.space/poster/small/${input.id}/img`;
  if (input.type === "movie") {
    item.behaviorHints = item.behaviorHints ?? { defaultVideoId: input.id, hasScheduledVideos: false };
  }
  item._mtime = new Date().toISOString();
  return item;
}

export function buildEpisodeWatchedChange(input: WatchedEpisodeInput): StremioLibraryItem {
  const item = cloneOrCreate(input.existing, input.id, "series", input.name, input.year, input.historyOnly);
  item.state = episodeWatchedState(
    item.state,
    input.videoId,
    input.watchedAt,
    input.season,
    input.episode,
    input.watchedField,
    input.seriesFlagged,
    input.undo
  );
  item._mtime = new Date().toISOString();
  return item;
}

function cloneOrCreate(
  existing: StremioLibraryItem | undefined,
  id: string,
  type: "movie" | "series",
  name: string,
  year: number | undefined,
  historyOnly: boolean
): StremioLibraryItem {
  if (existing) {
    const cloned = structuredClone(existing);
    if (historyOnly && cloned.removed !== false) {
      cloned.removed = true;
      cloned.temp = true;
    }
    return cloned;
  }

  const now = new Date().toISOString();
  const item: StremioLibraryItem = {
    _id: id,
    _ctime: now,
    _mtime: now,
    name,
    type,
    posterShape: "poster",
    removed: historyOnly,
    temp: historyOnly,
    state: {
      noNotif: false
    }
  };

  if (year !== undefined) item.year = year;
  if (id.startsWith("tt")) item.poster = `https://images.metahub.space/poster/small/${id}/img`;
  if (type === "movie") {
    item.behaviorHints = { defaultVideoId: id, hasScheduledVideos: false };
  }

  return item;
}

function watchedState(
  existingState: StremioLibraryState | undefined,
  videoId: string,
  watchedAt: string,
  undo: boolean
): StremioLibraryState {
  const state = structuredClone(existingState ?? {});

  if (undo) {
    state.timesWatched = 0;
    state.flaggedWatched = 0;
    return state;
  }

  state.lastWatched = watchedAt;
  state.timesWatched = Math.max(Number(state.timesWatched ?? 0), 1);
  state.flaggedWatched = 1;
  state.video_id = state.video_id ?? videoId;
  return state;
}

function episodeWatchedState(
  existingState: StremioLibraryState | undefined,
  videoId: string,
  watchedAt: string,
  season: number,
  episode: number,
  watchedField: string | null,
  seriesFlagged: boolean,
  undo: boolean
): StremioLibraryState {
  const state = structuredClone(existingState ?? {});

  // Series watched state lives in the compressed bitfield. Movie-level markers on
  // a series item can make clients interpret the whole show as watched.
  delete state.timeWatched;
  delete state.timeOffset;
  delete state.overallTimeWatched;
  delete state.duration;

  if (undo) {
    delete state.lastWatched;
    state.timesWatched = 0;
    state.flaggedWatched = 0;
    delete state.video_id;
    delete state.season;
    delete state.episode;
  } else {
    state.lastWatched = watchedAt;
    state.timesWatched = seriesFlagged ? 1 : 0;
    state.flaggedWatched = seriesFlagged ? 1 : 0;
    state.video_id = seriesFlagged ? videoId : "";
    state.season = seriesFlagged ? season : 0;
    state.episode = seriesFlagged ? episode : 0;
  }
  state.watched = watchedField;
  state.noNotif = false;
  return state;
}
