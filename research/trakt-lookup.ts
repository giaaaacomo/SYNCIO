import { requireFlag, runProbe } from "./lib/probe.js";
import { traktRequest } from "./lib/trakt.js";

await runProbe("trakt-lookup", async (args) => {
  const imdb = requireFlag(args, "imdb");
  const type = requireFlag(args, "type");
  const result = await traktRequest(`/search/imdb/${imdb}?type=${encodeURIComponent(type)}`);

  if (!Array.isArray(result.body)) {
    return { status: "FAIL", message: "Trakt lookup response was not an array." };
  }

  return {
    status: "PASS",
    message: `Fetched Trakt lookup for ${imdb}.`,
    details: {
      results: result.body.map(summarizeResult)
    }
  };
});

function summarizeResult(value: unknown): unknown {
  const item = record(value);
  const media = item.movie ? record(item.movie) : record(item.show);
  return {
    type: item.type,
    title: media.title,
    year: media.year,
    ids: media.ids
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
