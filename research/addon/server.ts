import { createServer } from "node:http";
import { nodeRequestHandler } from "./router.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "7017", 10);
const server = createServer(nodeRequestHandler(host, port));

server.on("error", (error) => {
  const code = error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "UNKNOWN";
  console.error(`FAIL: SYNCIO addon server could not listen on ${host}:${port} (${code}).`);
  console.error("Try a different PORT/HOST or run outside a restricted sandbox.");
  process.exitCode = 1;
});

server.listen(port, host, () => {
  const origin = `http://${host}:${port}`;
  console.log(`SYNCIO addon configure page: ${origin}/configure`);
  console.log(`SYNCIO addon manifest: ${origin}/manifest.json`);
  console.log(`Stremio install URL: stremio://${host}:${port}/manifest.json`);
  console.log("Press Ctrl+C to stop.");
});
