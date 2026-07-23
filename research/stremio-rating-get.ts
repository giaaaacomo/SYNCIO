import {
  getRatingStatus,
  parseMediaType,
  resolveStremioAuthKey
} from "./lib/stremio.js";
import { flag, printShape, requireFlag, runProbe } from "./lib/probe.js";

await runProbe("stremio-rating-get", async (args) => {
  const mediaId = requireFlag(args, "media-id");
  const mediaType = parseMediaType(flag(args, "media-type") ?? "movie");
  const authKey = await resolveStremioAuthKey();
  const result = await getRatingStatus(authKey, mediaId, mediaType);

  printShape("rating get response shape", result);

  return {
    status: "PASS",
    message: "Fetched Stremio rating status.",
    details: { mediaId, mediaType, result }
  };
});
