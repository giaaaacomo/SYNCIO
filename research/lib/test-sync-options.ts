import type { SyncRunOptions } from "./sync-run.js";

export const TEST_SYNC_OPTIONS: SyncRunOptions = {
  watched: {
    movieIds: ["tt0133093"],
    showIds: ["tt0903747", "tt3032476"]
  },
  ratings: {
    movieIds: ["tt0133093"]
  },
  watchlist: {
    movieIds: ["tt0816692"]
  }
};
