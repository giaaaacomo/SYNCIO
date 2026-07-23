import { runProbe } from "./lib/probe.js";
import { traktRequest } from "./lib/trakt.js";

await runProbe("trakt-last-activities", async () => {
  const result = await traktRequest("/sync/last_activities");
  return {
    status: "PASS",
    message: "Fetched Trakt /sync/last_activities.",
    details: {
      headers: result.headers,
      shape: result.shape,
      body: result.body
    }
  };
});
