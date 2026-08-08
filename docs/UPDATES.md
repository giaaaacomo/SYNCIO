# Updating a self-hosted SYNCIO installation

SYNCIO does not keep a central administrator token for user installations. An update therefore remains under the repository owner's control.

## Normal update flow

1. Open the SYNCIO `Configure` page and select **Check for updates**.
2. When an update is available, select **Review update** and enter the GitHub repository created for that installation.
3. Open the `Prepare SYNCIO update` workflow and select **Run workflow**. If the repository blocks pull-request creation by Actions, use the pre-filled comparison link shown in the run summary.
4. Review the pull request and its checks, then merge it.
5. Cloudflare's Git integration builds and deploys the production branch automatically.

The workflow copies the current public SYNCIO source into an update branch and preserves the installation-specific `wrangler.jsonc` file. It never reads Worker secrets or D1 data.
It also refuses to replace a preview or newer installation with an older public version.

## Why updates are not merged automatically

Merging from the configuration page would require a GitHub credential with write access to the installation repository. SYNCIO deliberately does not request or store that credential. The pull request is the approval boundary: code remains inspectable and a failed check cannot silently replace a working Worker.

## Stremio notification

The addon exposes an empty `SYNCIO Updates` catalog. It only returns an item when the installed Worker detects a newer public version. Opening that item leads back to the installation's `Configure` page. Stremio may cache catalog responses, so the notice can take up to an hour to appear.

Browser Companion updates are separate from Worker updates. During development they are installed manually from the `SYNCIO-companion` repository; store-based updates will be evaluated before a public browser-extension release.
