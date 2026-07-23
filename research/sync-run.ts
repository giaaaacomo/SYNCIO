import { previewSyncRun, applySyncRun } from "./lib/sync-run.js";
import { assertTestScopeForApply, loadSyncSettings, syncRunOptionsFromSettings } from "./lib/sync-settings.js";
import { boolFlag, runProbe } from "./lib/probe.js";

await runProbe("sync-run", async (args) => {
  const apply = boolFlag(args, "apply");
  const settings = await loadSyncSettings();
  if (apply) assertTestScopeForApply(settings);
  const options = syncRunOptionsFromSettings(settings);

  if (!apply) {
    return {
      status: "PASS",
      message: "Full test sync preview complete. Re-run with --apply to execute the guarded test sync run.",
      details: await previewSyncRun(options)
    };
  }

  return {
    status: "PASS",
    message: "Full test sync run complete.",
    details: await applySyncRun(options)
  };
});
