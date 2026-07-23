import { createServer } from "node:http";

const port = Number.parseInt(process.env.PORT ?? "7017", 10);
const manifest = JSON.stringify({
  id: "community.syncio.research",
  version: "0.0.0",
  name: "SYNCIO Research",
  description: "Milestone 0 no-catalog manifest probe for Stremio client compatibility.",
  resources: [],
  types: [],
  catalogs: [],
  behaviorHints: {
    configurable: true,
    configurationRequired: false
  }
}, null, 2);

const server = createServer((request, response) => {
  const url = request.url ?? "/";
  if (url === "/" || url === "/configure") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html());
    return;
  }

  if (url === "/manifest.json") {
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*"
    });
    response.end(manifest);
    return;
  }

  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
});

server.on("error", (error) => {
  const code = error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "UNKNOWN";
  console.error(`FAIL: manifest server could not listen on 127.0.0.1:${port} (${code}).`);
  console.error("Try a different PORT or run outside a restricted sandbox.");
  process.exitCode = 1;
});

server.listen(port, "127.0.0.1", () => {
  console.log(`SYNCIO minimal manifest probe listening on http://127.0.0.1:${port}/manifest.json`);
  console.log("Press Ctrl+C to stop.");
});

function html(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>SYNCIO Research Manifest</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
  <h1>SYNCIO Research Manifest</h1>
  <p>Manifest URL: <code>http://127.0.0.1:${port}/manifest.json</code></p>
  <p>This probe intentionally declares no catalogs or streams.</p>
</body>
</html>`;
}
