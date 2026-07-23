# Minimal Manifest Probe

This serves a Stremio addon manifest with:

- no catalogs;
- no stream resources;
- no subtitles;
- no account token in the URL.

Run:

```sh
npm run probe:manifest
```

Then test:

```text
http://127.0.0.1:7017/manifest.json
```

Record in `research/FINDINGS.md` whether Stremio Web, desktop, Android, Android TV, and iOS accept the manifest and whether it creates any Home/Board rows.
