import {
  parseMediaType,
  parseRatingStatus,
  resolveStremioAuthKey,
  sendRatingStatus
} from "./lib/stremio.js";
import { boolFlag, flag, requireFlag, runProbe } from "./lib/probe.js";

await runProbe("stremio-rating-send", async (args) => {
  const mediaId = requireFlag(args, "media-id");
  const mediaType = parseMediaType(flag(args, "media-type") ?? "movie");
  const status = parseRatingStatus(flag(args, "status") ?? "liked");
  const apply = boolFlag(args, "apply");

  if (!apply) {
    return {
      status: "PASS",
      message: "Dry-run complete. Re-run with --apply to send this Stremio rating status.",
      details: { mediaId, mediaType, status }
    };
  }

  const authKey = await resolveStremioAuthKey();
  const result = await sendRatingStatus(authKey, mediaId, mediaType, status);
  return {
    status: "PASS",
    message: "Sent Stremio rating status.",
    details: { mediaId, mediaType, status, result }
  };
});
