import { updateDotEnv } from "./lib/env-file.js";
import { boolFlag, env, ProbeAbort, runProbe } from "./lib/probe.js";
import { readTraktAccountSummary } from "./lib/trakt.js";

await runProbe("trakt-account", async (args) => {
  const summary = await readTraktAccountSummary();
  const expectedUsername = env("TRAKT_EXPECTED_USERNAME");

  if (expectedUsername && summary.username !== expectedUsername) {
    throw new ProbeAbort(
      "FAIL",
      `Trakt account guard failed: expected ${expectedUsername}, got ${summary.username ?? "unknown"}.`
    );
  }

  if (boolFlag(args, "lock-expected")) {
    if (!summary.username) {
      throw new ProbeAbort("FAIL", "Cannot lock Trakt account guard because username is missing.");
    }
    updateDotEnv({ TRAKT_EXPECTED_USERNAME: summary.username });
  }

  return {
    status: "PASS",
    message: "Fetched Trakt account settings summary.",
    details: {
      account: summary,
      guard: expectedUsername ? "matched" : boolFlag(args, "lock-expected") ? "saved" : "not-set"
    }
  };
});
