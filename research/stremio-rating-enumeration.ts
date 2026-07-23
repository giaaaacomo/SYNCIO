import { getLibraryItems } from "./lib/stremio.js";
import {
  getRatingStatus,
  resolveStremioAuthKey
} from "./lib/stremio.js";
import { intFlag, runProbe } from "./lib/probe.js";

await runProbe("stremio-rating-enumeration", async (args) => {
  const sampleSize = intFlag(args, "sample-size", 10);
  const authKey = await resolveStremioAuthKey();
  const items = await getLibraryItems(authKey);
  const candidates = items
    .filter((item) => item.type === "movie" || item.type === "series")
    .slice(0, sampleSize);

  if (candidates.length === 0) {
    return {
      status: "SKIP",
      message: "No movie/series library items are available for rating enumeration fallback."
    };
  }

  const statuses: unknown[] = [];
  for (const item of candidates) {
    const mediaType = item.type === "series" ? "series" : "movie";
    const status = await getRatingStatus(authKey, item._id, mediaType);
    statuses.push({ mediaId: item._id, mediaType, status });
  }

  return {
    status: "PASS",
    message: "Known-item rating sweep completed. This is a fallback probe, not proof of a bulk endpoint.",
    details: {
      sampled: statuses.length,
      bulkEndpointConfirmed: false,
      statuses
    }
  };
});
