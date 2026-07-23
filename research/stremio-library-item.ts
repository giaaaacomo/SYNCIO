import { findLibraryItem } from "./lib/library-items.js";
import { getLibraryItems, resolveStremioAuthKey } from "./lib/stremio.js";
import { requireFlag, runProbe } from "./lib/probe.js";

await runProbe("stremio-library-item", async (args) => {
  const id = requireFlag(args, "media-id");
  const authKey = await resolveStremioAuthKey();
  const item = findLibraryItem(await getLibraryItems(authKey), id);

  if (!item) {
    return {
      status: "FAIL",
      message: `No Stremio libraryItem found for ${id}.`
    };
  }

  return {
    status: "PASS",
    message: `Fetched Stremio libraryItem for ${id}.`,
    details: {
      item
    }
  };
});
