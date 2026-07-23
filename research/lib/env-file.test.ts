import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chdir } from "node:process";
import { updateDotEnv } from "./env-file.js";

const originalCwd = process.cwd();

test("updates .env on disk and in the current process", () => {
  const dir = mkdtempSync(join(tmpdir(), "syncio-env-"));
  try {
    chdir(dir);
    delete process.env.SYNCIO_ENV_FILE_TEST_VALUE;

    updateDotEnv({ SYNCIO_ENV_FILE_TEST_VALUE: "new-value" });

    assert.match(readFileSync(".env", "utf8"), /SYNCIO_ENV_FILE_TEST_VALUE=new-value/);
    assert.equal(process.env.SYNCIO_ENV_FILE_TEST_VALUE, "new-value");
  } finally {
    chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
    delete process.env.SYNCIO_ENV_FILE_TEST_VALUE;
  }
});
