import { requestJson } from "./http.js";
import { env, ProbeAbort } from "./probe.js";

export interface CinemetaVideoSet {
  id: string;
  name?: string;
  videos: string[];
}

interface CinemetaVideo {
  id?: unknown;
}

interface CinemetaDetailed {
  id?: unknown;
  name?: unknown;
  videos?: unknown;
}

export async function fetchCinemetaVideoIds(imdbIds: string[]): Promise<CinemetaVideoSet[]> {
  if (imdbIds.length === 0) return [];
  const base = env("CINEMETA_VIDEO_IDS_BASE")
    ?? "https://v3-cinemeta.strem.io/catalog/series/video-ids/imdbIds=";
  const response = await requestJson(`${base}${imdbIds.join(",")}`);

  if (!response.ok) {
    throw new ProbeAbort("FAIL", `Cinemeta video ID request failed with HTTP ${response.status}.`);
  }

  const body = response.body;
  if (!body || typeof body !== "object") {
    throw new ProbeAbort("FAIL", "Cinemeta response was not an object.");
  }

  const metas = (body as { metasDetailed?: unknown }).metasDetailed;
  if (!Array.isArray(metas)) {
    throw new ProbeAbort("FAIL", "Cinemeta response did not include metasDetailed array.");
  }

  return metas.map(toVideoSet).filter((item): item is CinemetaVideoSet => item !== null);
}

function toVideoSet(value: unknown): CinemetaVideoSet | null {
  if (!value || typeof value !== "object") return null;
  const meta = value as CinemetaDetailed;
  if (typeof meta.id !== "string") return null;
  const videos = Array.isArray(meta.videos)
    ? meta.videos
      .map((video: CinemetaVideo | string) => {
        if (typeof video === "string") return video;
        return video && typeof video.id === "string" ? video.id : null;
      })
      .filter((id): id is string => id !== null)
    : [];
  const output: CinemetaVideoSet = {
    id: meta.id,
    videos
  };
  if (typeof meta.name === "string") output.name = meta.name;
  return output;
}
