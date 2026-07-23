import { ProbeAbort, runProbe } from "./lib/probe.js";
import { traktRequest } from "./lib/trakt.js";

const EXPECTED = {
  matrix: { imdb: "tt0133093", title: "The Matrix", year: 1999, rating: 8 },
  breakingBad: { imdb: "tt0903747", trakt: 1388, title: "Breaking Bad", season: 1, episode: 1 },
  interstellar: { imdb: "tt0816692", title: "Interstellar", year: 2014 }
};

await runProbe("trakt-baseline", async () => {
  const [
    watchedMovies,
    watchedShows,
    breakingBadHistory,
    ratedMovies,
    watchlistMovies
  ] = await Promise.all([
    fetchArray("/sync/watched/movies"),
    fetchArray("/sync/watched/shows"),
    fetchArray(`/sync/history/shows/${EXPECTED.breakingBad.trakt}`),
    fetchArray("/sync/ratings/movies"),
    fetchArray("/sync/watchlist/movies")
  ]);

  const matrixWatched = findMediaItem(watchedMovies, "movie", EXPECTED.matrix.imdb);
  const matrixRating = findMediaItem(ratedMovies, "movie", EXPECTED.matrix.imdb);
  const breakingBadEpisode = findHistoryEpisode(
    breakingBadHistory,
    EXPECTED.breakingBad.imdb,
    EXPECTED.breakingBad.season,
    EXPECTED.breakingBad.episode
  );
  const interstellarWatchlist = findMediaItem(watchlistMovies, "movie", EXPECTED.interstellar.imdb);

  const checks = {
    matrixWatched: matrixWatched !== undefined,
    matrixRating: ratingOf(matrixRating) === EXPECTED.matrix.rating,
    breakingBadS01E01Watched: breakingBadEpisode !== undefined,
    interstellarWatchlist: interstellarWatchlist !== undefined
  };

  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  const details = {
    checks,
    summary: {
      watchedMovies: watchedMovies.length,
      watchedShows: watchedShows.length,
      breakingBadHistory: breakingBadHistory.length,
      ratedMovies: ratedMovies.length,
      watchlistMovies: watchlistMovies.length,
      matrix: {
        watched: summarizeMediaItem(matrixWatched, "movie"),
        ratingApiScale: ratingOf(matrixRating),
        ratingUserScale: "4/5"
      },
      breakingBad: {
        show: summarizeMediaItem(findMediaItem(watchedShows, "show", EXPECTED.breakingBad.imdb), "show"),
        episode: summarizeHistoryEpisode(breakingBadEpisode),
        nearbyHistory: summarizeHistoryEpisodes(breakingBadHistory, EXPECTED.breakingBad.imdb).slice(0, 8)
      },
      interstellar: {
        watchlist: summarizeMediaItem(interstellarWatchlist, "movie")
      }
    }
  };

  if (failed.length > 0) {
    return {
      status: "FAIL",
      message: `Trakt baseline missing expected seed data: ${failed.join(", ")}.`,
      details
    };
  }

  return {
    status: "PASS",
    message: "Verified expected Trakt test baseline.",
    details
  };
});

async function fetchArray(endpoint: string): Promise<unknown[]> {
  const result = await traktRequest(endpoint);
  if (!Array.isArray(result.body)) {
    throw new ProbeAbort("FAIL", `Trakt ${endpoint} did not return an array.`);
  }
  return result.body;
}

function findMediaItem(items: unknown[], key: "movie" | "show", imdb: string): Record<string, unknown> | undefined {
  return items.find((item) => {
    const media = mediaRecord(item, key);
    return ids(media).imdb === imdb;
  }) as Record<string, unknown> | undefined;
}

function findHistoryEpisode(
  history: unknown[],
  showImdb: string,
  seasonNumber: number,
  episodeNumber: number
): Record<string, unknown> | undefined {
  return history.find((item) => {
    const show = mediaRecord(item, "show");
    const episode = mediaRecord(item, "episode");
    return ids(show).imdb === showImdb
      && episode?.season === seasonNumber
      && episode.number === episodeNumber;
  }) as Record<string, unknown> | undefined;
}

function summarizeMediaItem(item: unknown, key: "movie" | "show"): unknown {
  const media = mediaRecord(item, key);
  if (!media) return undefined;
  return {
    title: stringValue(media.title),
    year: numberValue(media.year),
    ids: ids(media),
    plays: numberValue(record(item).plays),
    lastWatchedAt: stringValue(record(item).last_watched_at),
    listedAt: stringValue(record(item).listed_at)
  };
}

function summarizeHistoryEpisode(item: unknown): unknown {
  const history = record(item);
  const show = mediaRecord(item, "show");
  const episode = mediaRecord(item, "episode");
  if (!show || !episode) return undefined;
  return {
    action: stringValue(history.action),
    watchedAt: stringValue(history.watched_at),
    show: {
      title: stringValue(show.title),
      year: numberValue(show.year),
      ids: ids(show)
    },
    episode: {
      season: numberValue(episode.season),
      number: numberValue(episode.number),
      title: stringValue(episode.title),
      ids: ids(episode)
    }
  };
}

function summarizeHistoryEpisodes(history: unknown[], showImdb: string): unknown[] {
  return history
    .filter((item) => ids(mediaRecord(item, "show")).imdb === showImdb)
    .map(summarizeHistoryEpisode);
}

function mediaRecord(item: unknown, key: "movie" | "show" | "episode"): Record<string, unknown> | undefined {
  const value = record(item)[key];
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function ids(media: Record<string, unknown> | undefined): Record<string, unknown> {
  const value = media?.ids;
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function ratingOf(item: unknown): number | undefined {
  return numberValue(record(item).rating);
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
