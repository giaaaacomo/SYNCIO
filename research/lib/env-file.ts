import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

export function updateDotEnv(values: Record<string, string>): void {
  const path = ".env";
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const keys = new Set(Object.keys(values));
  const lines = existing.split(/\r?\n/).filter((line) => {
    if (!line.trim()) return false;
    const key = line.split("=", 1)[0];
    if (!key) return false;
    return !keys.has(key);
  });

  for (const [key, value] of Object.entries(values)) {
    lines.push(`${key}=${value}`);
    process.env[key] = value;
  }

  if (lines.length === 0) appendFileSync(path, "");
  writeFileSync(path, `${lines.join("\n")}\n`, { mode: 0o600 });
}
