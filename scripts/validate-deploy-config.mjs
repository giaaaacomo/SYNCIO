import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const wrangler = JSON.parse(await readFile(new URL("wrangler.jsonc", root), "utf8"));
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const secretTemplate = await readFile(new URL(".dev.vars.example", root), "utf8");
const expectedDatabaseName = process.env.SYNCIO_EXPECTED_DATABASE_NAME ?? "syncio";

const requiredSecrets = ["SYNCIO_ENCRYPTION_KEY", "SYNCIO_SETUP_TOKEN"];
const templateSecrets = secretTemplate
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => line.split("=", 1)[0])
  .sort();

assert.deepEqual(wrangler.secrets?.required?.slice().sort(), requiredSecrets);
assert.deepEqual(templateSecrets, requiredSecrets);
assert.equal(wrangler.d1_databases?.length, 1);
assert.equal(wrangler.d1_databases[0]?.binding, "SYNCIO_DB");
assert.equal(wrangler.d1_databases[0]?.database_name, expectedDatabaseName);
assert.match(packageJson.scripts?.deploy ?? "", /d1 migrations apply SYNCIO_DB --remote/);
assert.match(packageJson.scripts?.deploy ?? "", /wrangler deploy/);
for (const secret of requiredSecrets) {
  assert.equal(typeof packageJson.cloudflare?.bindings?.[secret]?.description, "string");
}

console.log("Deploy configuration is internally consistent.");
