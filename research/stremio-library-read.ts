import {
  getLibraryItems,
  resolveStremioAuthKey,
  type StremioLibraryItem
} from "./lib/stremio.js";
import {
  isHistoryOnlyLibraryItem,
  isVisibleLibraryItem
} from "./lib/library-items.js";
import { printShape, runProbe } from "./lib/probe.js";

await runProbe("stremio-library-read", async () => {
  const authKey = await resolveStremioAuthKey();
  const items = await getLibraryItems(authKey);
  const byType = countBy(items, (item) => String(item.type ?? "unknown"));

  printShape("libraryItem array shape", items);

  return {
    status: "PASS",
    message: `Read ${items.length} Stremio libraryItem records.`,
    details: {
      total: items.length,
      visible: items.filter(isVisibleLibraryItem).length,
      historyOnly: items.filter(isHistoryOnlyLibraryItem).length,
      removed: items.filter((item) => item.removed === true).length,
      temp: items.filter((item) => item.temp === true).length,
      byType
    }
  };
});

function countBy(
  items: StremioLibraryItem[],
  getKey: (item: StremioLibraryItem) => string
): Record<string, number> {
  const output: Record<string, number> = {};
  for (const item of items) {
    const key = getKey(item);
    output[key] = (output[key] ?? 0) + 1;
  }
  return output;
}
