import { flag, intFlag, runProbe } from "./lib/probe.js";
import { traktPaginated } from "./lib/trakt.js";

await runProbe("trakt-pagination", async (args) => {
  const endpoint = flag(args, "endpoint") ?? "/sync/watched/movies";
  const limit = intFlag(args, "limit", 250);
  const maxPages = intFlag(args, "max-pages", 1);
  const pages = await traktPaginated(endpoint, limit, maxPages);
  const firstPage = pages[0];

  return {
    status: "PASS",
    message: `Fetched ${pages.length} explicit Trakt page(s) from ${endpoint}.`,
    details: {
      endpoint,
      limit,
      maxPages,
      firstPageHeaders: firstPage?.headers,
      firstPageShape: firstPage?.shape,
      fetchedPages: pages.map((page) => ({
        page: page.page,
        headers: page.headers,
        shape: page.shape
      }))
    }
  };
});
