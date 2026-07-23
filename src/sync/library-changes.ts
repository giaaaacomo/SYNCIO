import type { StremioLibraryItem } from "./api-clients.js";

export function buildVisibleMovie(
  existing: StremioLibraryItem | undefined,
  id: string,
  name: string
): StremioLibraryItem {
  const item = cloneOrCreate(existing, id, "movie", name, false);
  item.removed = false;
  item.temp = false;
  item.name = name;
  item.state = structuredClone(item.state ?? {});
  item.state.noNotif = false;
  item.behaviorHints ??= { defaultVideoId: id, hasScheduledVideos: false };
  return touch(item);
}

export function buildWatchedMovie(
  existing: StremioLibraryItem | undefined,
  id: string,
  name: string,
  watchedAt: string
): StremioLibraryItem {
  const item = cloneOrCreate(existing, id, "movie", name, true);
  item.state = structuredClone(item.state ?? {});
  item.state.lastWatched = watchedAt;
  item.state.timesWatched = Math.max(Number(item.state.timesWatched ?? 0), 1);
  item.state.flaggedWatched = 1;
  item.state.video_id ??= id;
  return touch(item);
}

export function buildWatchedSeries(
  existing: StremioLibraryItem | undefined,
  id: string,
  name: string,
  watchedField: string,
  watchedAt: string
): StremioLibraryItem {
  const item = cloneOrCreate(existing, id, "series", name, true);
  const state = structuredClone(item.state ?? {});
  delete state.timeWatched;
  delete state.timeOffset;
  delete state.overallTimeWatched;
  delete state.duration;
  state.lastWatched = watchedAt;
  state.timesWatched = 0;
  state.flaggedWatched = 0;
  state.video_id = "";
  state.season = 0;
  state.episode = 0;
  state.watched = watchedField;
  state.noNotif = false;
  item.state = state;
  return touch(item);
}

function cloneOrCreate(
  existing: StremioLibraryItem | undefined,
  id: string,
  type: "movie" | "series",
  name: string,
  historyOnly: boolean
): StremioLibraryItem {
  if (existing) {
    const item = structuredClone(existing);
    if (historyOnly && item.removed !== false) {
      item.removed = true;
      item.temp = true;
    }
    return item;
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
    state: { noNotif: false }
  };
  if (id.startsWith("tt")) item.poster = `https://images.metahub.space/poster/small/${id}/img`;
  if (type === "movie") item.behaviorHints = { defaultVideoId: id, hasScheduledVideos: false };
  return item;
}

function touch(item: StremioLibraryItem): StremioLibraryItem {
  item._mtime = new Date().toISOString();
  return item;
}
