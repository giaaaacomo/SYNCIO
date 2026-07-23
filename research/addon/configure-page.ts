import { SYNCIO_MANIFEST, manifestUrl, stremioInstallUrl } from "./manifest.js";
import type { SyncSettings } from "../lib/sync-settings.js";
import type { AddonRuntimeStatus } from "./status.js";

export function configurePage(origin: string, status: AddonRuntimeStatus, settings: SyncSettings): string {
  const manifest = escapeHtml(manifestUrl(origin));
  const install = escapeHtml(stremioInstallUrl(origin));
  const stremioClass = status.accounts.stremio === "configured" ? "ok" : "pending";
  const traktClass = status.accounts.trakt === "configured" ? "ok" : "pending";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>SYNCIO</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f6f7f9;
      --ink: #1d252d;
      --muted: #66717d;
      --line: #cfd6dd;
      --panel: #ffffff;
      --accent: #0f766e;
      --accent-ink: #ffffff;
      --warn: #9a3412;
      --ok: #047857;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #101418;
        --ink: #eef2f5;
        --muted: #a7b1bb;
        --line: #34404b;
        --panel: #171d23;
        --accent: #2dd4bf;
        --accent-ink: #06201c;
        --warn: #fdba74;
        --ok: #6ee7b7;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font: 16px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--ink);
    }
    main {
      width: min(760px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 56px 0;
    }
    header {
      margin-bottom: 28px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: clamp(2rem, 7vw, 4.25rem);
      line-height: 0.95;
      letter-spacing: 0;
    }
    p {
      max-width: 62ch;
      margin: 0 0 16px;
      color: var(--muted);
    }
    section {
      border-top: 1px solid var(--line);
      padding: 24px 0;
    }
    h2 {
      margin: 0 0 14px;
      font-size: 1rem;
      letter-spacing: 0;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 18px;
    }
    a.button, button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 44px;
      padding: 0 16px;
      border: 0;
      border-radius: 6px;
      background: var(--accent);
      color: var(--accent-ink);
      text-decoration: none;
      font-weight: 700;
      font: inherit;
      cursor: pointer;
    }
    button.secondary {
      background: transparent;
      color: var(--ink);
      border: 1px solid var(--line);
    }
    button:disabled {
      cursor: wait;
      opacity: 0.72;
    }
    code {
      display: block;
      overflow-wrap: anywhere;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel);
      color: var(--ink);
    }
    dl {
      display: grid;
      grid-template-columns: minmax(120px, 180px) 1fr;
      gap: 8px 16px;
      margin: 0;
    }
    dt { color: var(--muted); }
    dd { margin: 0; }
    .pending { color: var(--warn); font-weight: 700; }
    .ok { color: var(--ok); font-weight: 700; }
    .notice {
      margin-top: 14px;
      min-height: 24px;
      color: var(--muted);
    }
    .review {
      margin-top: 18px;
      display: grid;
      gap: 14px;
      color: var(--ink);
    }
    .metric-row {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }
    .metric {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px 12px;
      background: var(--panel);
    }
    .metric strong {
      display: block;
      font-size: 1.5rem;
      line-height: 1.1;
    }
    .metric span {
      color: var(--muted);
      font-size: 0.875rem;
    }
    .review-section {
      border-top: 1px solid var(--line);
      padding-top: 12px;
    }
    .review-section h3 {
      margin: 0 0 8px;
      font-size: 0.95rem;
    }
    .review-section ul {
      margin: 0;
      padding-left: 20px;
      color: var(--muted);
    }
    .warning-list {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 12px;
      background: var(--panel);
      color: var(--warn);
    }
    .code {
      margin: 12px 0;
      font-size: 2rem;
      font-weight: 800;
      color: var(--ink);
    }
    .settings-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px 18px;
      max-width: 560px;
    }
    label {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--ink);
    }
    input[type="number"], select {
      width: 72px;
      min-height: 38px;
      padding: 6px 8px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel);
      color: var(--ink);
      font: inherit;
    }
    select {
      width: min(180px, 100%);
    }
    pre {
      max-height: 460px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel);
      color: var(--ink);
    }
    @media (max-width: 560px) {
      main { padding: 36px 0; }
      dl { grid-template-columns: 1fr; gap: 2px 0; }
      dd { margin-bottom: 10px; }
      .settings-grid { grid-template-columns: 1fr; }
      .metric-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      a.button { width: 100%; justify-content: center; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>SYNCIO</h1>
      <p>Installable Stremio addon shell for deep Trakt synchronization.</p>
      <div class="actions">
        <a class="button" href="${install}">Try Desktop Install</a>
      </div>
    </header>
    <section>
      <h2>Add-on Repository URL</h2>
      <code>${manifest}</code>
      <p>For local testing, paste this URL into Stremio's add-on repository field. Some desktop builds rewrite the shortcut link and drop the local port.</p>
    </section>
    <section>
      <h2>Desktop Shortcut</h2>
      <code>${install}</code>
    </section>
    <section>
      <h2>Status</h2>
      <dl>
        <dt>Addon</dt>
        <dd>${escapeHtml(SYNCIO_MANIFEST.version)}</dd>
        <dt>Stremio</dt>
        <dd class="${stremioClass}">${accountLabel(status.accounts.stremio)}</dd>
        <dt>Trakt</dt>
        <dd class="${traktClass}">${accountLabel(status.accounts.trakt)}</dd>
        <dt>Sync engine</dt>
        <dd>Local development shell</dd>
        <dt>State</dt>
        <dd>${status.sync.trackedOperations} tracked operations</dd>
      </dl>
    </section>
    <section>
      <h2>Sync Settings</h2>
      <div class="settings-grid">
        <label><input id="setting-watched" type="checkbox"${checked(settings.enabled.watched)}> Watched</label>
        <label><input id="setting-ratings" type="checkbox"${checked(settings.enabled.ratings)}> Ratings</label>
        <label><input id="setting-watchlist" type="checkbox"${checked(settings.enabled.watchlist)}> Watchlist</label>
        <label>Like threshold <input id="setting-like-threshold" type="number" min="1" max="10" step="1" value="${settings.ratings.likeThreshold}"></label>
        <label>Love threshold <input id="setting-love-threshold" type="number" min="1" max="10" step="1" value="${settings.ratings.loveThreshold}"></label>
        <label>Scope <select id="setting-scope">
          <option value="test"${selected(settings.scope, "test")}>Test</option>
          <option value="account-preview"${selected(settings.scope, "account-preview")}>Account preview</option>
        </select></label>
      </div>
      <div class="actions">
        <button id="settings-save" type="button">Save Settings</button>
      </div>
      <div id="settings-result" class="notice"></div>
    </section>
    <section>
      <h2>Trakt Link</h2>
      <p>Start a Device OAuth link, authorize the test Trakt account, then complete the local handshake.</p>
      <div class="actions">
        <button id="trakt-start" type="button">Start Trakt Link</button>
        <button id="trakt-poll" class="secondary" type="button">Complete Link</button>
        <button id="trakt-verify" class="secondary" type="button">Verify Trakt Account</button>
      </div>
      <div id="trakt-result" class="notice"></div>
    </section>
    <section>
      <h2>Sync Preview</h2>
      <p>Preview guarded dry-runs for the current test set.</p>
      <div class="actions">
        <button id="full-preview" type="button">Preview Full Test Sync</button>
        <button id="full-apply" class="secondary" type="button">Apply Full Test Sync</button>
        <button id="sync-preview" type="button">Preview Watched Sync</button>
        <button id="sync-apply" class="secondary" type="button">Apply Watched Test</button>
        <button id="ratings-preview" class="secondary" type="button">Preview Ratings</button>
        <button id="ratings-apply" class="secondary" type="button">Apply Ratings Test</button>
        <button id="watchlist-preview" class="secondary" type="button">Preview Watchlist</button>
        <button id="watchlist-apply" class="secondary" type="button">Apply Watchlist Test</button>
      </div>
      <div id="sync-result" class="notice"></div>
    </section>
  </main>
  <script>
    const result = document.querySelector("#trakt-result");
    const syncResult = document.querySelector("#sync-result");
    const settingsResult = document.querySelector("#settings-result");
    const startButton = document.querySelector("#trakt-start");
    const pollButton = document.querySelector("#trakt-poll");
    const verifyButton = document.querySelector("#trakt-verify");
    const settingsSaveButton = document.querySelector("#settings-save");
    const settingWatched = document.querySelector("#setting-watched");
    const settingRatings = document.querySelector("#setting-ratings");
    const settingWatchlist = document.querySelector("#setting-watchlist");
    const settingLikeThreshold = document.querySelector("#setting-like-threshold");
    const settingLoveThreshold = document.querySelector("#setting-love-threshold");
    const settingScope = document.querySelector("#setting-scope");
    const fullPreviewButton = document.querySelector("#full-preview");
    const fullApplyButton = document.querySelector("#full-apply");
    const syncPreviewButton = document.querySelector("#sync-preview");
    const syncApplyButton = document.querySelector("#sync-apply");
    const ratingsPreviewButton = document.querySelector("#ratings-preview");
    const ratingsApplyButton = document.querySelector("#ratings-apply");
    const watchlistPreviewButton = document.querySelector("#watchlist-preview");
    const watchlistApplyButton = document.querySelector("#watchlist-apply");

    startButton.addEventListener("click", async () => {
      await callTrakt("/oauth/trakt/start", startButton, (body) => {
        result.innerHTML = [
          "<div>Visit <a href=\\"" + escapeHtml(body.verificationUrl) + "\\" target=\\"_blank\\" rel=\\"noreferrer\\">" + escapeHtml(body.verificationUrl) + "</a></div>",
          "<div class=\\"code\\">" + escapeHtml(body.userCode) + "</div>",
          "<div>Then click Complete Link.</div>"
        ].join("");
      });
    });

    pollButton.addEventListener("click", async () => {
      await callTrakt("/oauth/trakt/poll", pollButton, (body, status) => {
        if (status === 202) {
          result.textContent = "Still waiting for Trakt authorization.";
          return;
        }
        result.textContent = "Trakt linked locally. Refresh this page to see status update.";
      });
    });

    verifyButton.addEventListener("click", async () => {
      await callTrakt("/account/trakt/verify", verifyButton, (body) => {
        const username = body.account && body.account.username ? body.account.username : "unknown";
        result.textContent = "Trakt account: " + username + " (" + body.guard + ").";
      });
    });

    settingsSaveButton.addEventListener("click", async () => {
      const settings = {
        version: 1,
        scope: settingScope.value,
        enabled: {
          watched: settingWatched.checked,
          ratings: settingRatings.checked,
          watchlist: settingWatchlist.checked
        },
        ratings: {
          likeThreshold: Number(settingLikeThreshold.value),
          loveThreshold: Number(settingLoveThreshold.value)
        }
      };
      await callAction("/sync/settings", settingsSaveButton, settingsResult, () => {
        settingsResult.textContent = "Settings saved locally.";
      }, {
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings)
      });
    });

    fullPreviewButton.addEventListener("click", async () => {
      await callAction("/sync/preview", fullPreviewButton, syncResult, (body) => {
        syncResult.innerHTML = renderSyncResult(body);
      });
    });

    fullApplyButton.addEventListener("click", async () => {
      await callAction("/sync/run", fullApplyButton, syncResult, (body) => {
        syncResult.innerHTML = renderSyncResult(body);
      });
    });

    syncPreviewButton.addEventListener("click", async () => {
      await callAction("/sync/watched/preview", syncPreviewButton, syncResult, (body) => {
        syncResult.innerHTML = "<pre>" + escapeHtml(formatResult(body)) + "</pre>";
      });
    });

    syncApplyButton.addEventListener("click", async () => {
      await callAction("/sync/watched/apply", syncApplyButton, syncResult, (body) => {
        syncResult.innerHTML = "<pre>" + escapeHtml(formatResult(body)) + "</pre>";
      });
    });

    ratingsPreviewButton.addEventListener("click", async () => {
      await callAction("/sync/ratings/preview", ratingsPreviewButton, syncResult, (body) => {
        syncResult.innerHTML = "<pre>" + escapeHtml(formatResult(body)) + "</pre>";
      });
    });

    ratingsApplyButton.addEventListener("click", async () => {
      await callAction("/sync/ratings/apply", ratingsApplyButton, syncResult, (body) => {
        syncResult.innerHTML = "<pre>" + escapeHtml(formatResult(body)) + "</pre>";
      });
    });

    watchlistPreviewButton.addEventListener("click", async () => {
      await callAction("/sync/watchlist/preview", watchlistPreviewButton, syncResult, (body) => {
        syncResult.innerHTML = "<pre>" + escapeHtml(formatResult(body)) + "</pre>";
      });
    });

    watchlistApplyButton.addEventListener("click", async () => {
      await callAction("/sync/watchlist/apply", watchlistApplyButton, syncResult, (body) => {
        syncResult.innerHTML = "<pre>" + escapeHtml(formatResult(body)) + "</pre>";
      });
    });

    async function callTrakt(path, button, onOk) {
      await callAction(path, button, result, onOk);
    }

    async function callAction(path, button, target, onOk, init = {}) {
      button.disabled = true;
      try {
        const response = await fetch(path, { method: "POST", ...init });
        const body = await response.json();
        if (!response.ok && response.status !== 202) {
          target.textContent = body.error || body.stderr || ("Request failed with HTTP " + response.status + ".");
          return;
        }
        onOk(body, response.status);
      } catch (error) {
        target.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        button.disabled = false;
      }
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    function formatResult(body) {
      return body.stdout || body.stderr || JSON.stringify(body, null, 2);
    }

    function renderSyncResult(body) {
      if (!body.review) return "<pre>" + escapeHtml(formatResult(body)) + "</pre>";
      const review = body.review;
      const summary = review.summary || {};
      const sections = Array.isArray(review.sections) ? review.sections : [];
      const warnings = Array.isArray(review.warnings) ? review.warnings : [];
      return [
        "<div class=\\"review\\">",
        "<h3>" + escapeHtml(review.headline || "Sync preview") + "</h3>",
        "<div class=\\"metric-row\\">",
        metric("Total", summary.plannedChanges),
        metric("Watched", summary.watched),
        metric("Ratings", summary.ratings),
        metric("Watchlist", summary.watchlist),
        "</div>",
        warnings.length ? "<div class=\\"warning-list\\">" + warnings.map((line) => "<div>" + escapeHtml(line) + "</div>").join("") + "</div>" : "",
        sections.map(renderReviewSection).join(""),
        "<pre>" + escapeHtml(formatResult(body)) + "</pre>",
        "</div>"
      ].join("");
    }

    function metric(label, value) {
      return "<div class=\\"metric\\"><strong>" + escapeHtml(value ?? 0) + "</strong><span>" + escapeHtml(label) + "</span></div>";
    }

    function renderReviewSection(section) {
      const lines = Array.isArray(section.lines) ? section.lines : [];
      return [
        "<div class=\\"review-section\\">",
        "<h3>" + escapeHtml(section.title || "Section") + "</h3>",
        "<ul>",
        lines.map((line) => "<li>" + escapeHtml(line) + "</li>").join(""),
        "</ul>",
        "</div>"
      ].join("");
    }
  </script>
</body>
</html>`;
}

function accountLabel(value: "configured" | "missing"): string {
  return value === "configured" ? "Configured locally" : "Not connected";
}

function checked(value: boolean): string {
  return value ? " checked" : "";
}

function selected(value: string, candidate: string): string {
  return value === candidate ? " selected" : "";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
