import { existsSync, readFileSync } from "node:fs";

export type ProbeStatus = "PASS" | "FAIL" | "SKIP";

export interface Args {
  flags: Map<string, string | boolean>;
  positionals: string[];
}

export interface ProbeResult {
  status: ProbeStatus;
  message: string;
  details?: unknown;
}

export class ProbeAbort extends Error {
  readonly status: ProbeStatus;

  constructor(status: ProbeStatus, message: string) {
    super(message);
    this.name = "ProbeAbort";
    this.status = status;
  }
}

const SECRET_KEY_PATTERN = /auth|token|password|secret|key|authorization|refresh|user_?id/i;

loadDotEnv();

export function parseArgs(argv = process.argv.slice(2)): Args {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const withoutPrefix = arg.slice(2);
    if (withoutPrefix.startsWith("no-")) {
      flags.set(withoutPrefix.slice(3), false);
      continue;
    }

    const equalsIndex = withoutPrefix.indexOf("=");
    if (equalsIndex !== -1) {
      flags.set(withoutPrefix.slice(0, equalsIndex), withoutPrefix.slice(equalsIndex + 1));
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(withoutPrefix, next);
      index += 1;
    } else {
      flags.set(withoutPrefix, true);
    }
  }

  return { flags, positionals };
}

export function flag(args: Args, name: string): string | undefined {
  const value = args.flags.get(name);
  if (typeof value === "string") return value;
  return undefined;
}

export function boolFlag(args: Args, name: string): boolean {
  return args.flags.get(name) === true;
}

export function intFlag(args: Args, name: string, fallback: number): number {
  const raw = flag(args, name);
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    throw new ProbeAbort("FAIL", `Invalid --${name}: expected an integer.`);
  }
  return value;
}

export function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export function requireEnv(name: string): string {
  const value = env(name);
  if (!value) throw new ProbeAbort("FAIL", `Missing required environment variable ${name}.`);
  return value;
}

export function requireFlag(args: Args, name: string, envName?: string): string {
  const value = flag(args, name) ?? (envName ? env(envName) : undefined);
  if (!value) {
    const suffix = envName ? ` or ${envName}` : "";
    throw new ProbeAbort("FAIL", `Missing required --${name}${suffix}.`);
  }
  return value;
}

export function redact(value: unknown, keyHint = ""): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    if (SECRET_KEY_PATTERN.test(keyHint) || looksSecret(value)) return redactString(value);
    return redactUrl(value);
  }

  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, keyHint));
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SECRET_KEY_PATTERN.test(key) ? redactSecretValue(child) : redact(child, key);
    }
    return output;
  }

  return String(value);
}

export function shapeOf(value: unknown, depth = 0): unknown {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `string(length=${value.length})`;
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      sample: depth > 4 || value.length === 0 ? undefined : shapeOf(value[0], depth + 1)
    };
  }
  if (typeof value === "object") {
    if (depth > 4) return "object";
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 30);
    const output: Record<string, unknown> = {};
    for (const [key, child] of entries) output[key] = shapeOf(child, depth + 1);
    return output;
  }
  return typeof value;
}

export function printJson(label: string, value: unknown): void {
  console.log(`\n${label}:`);
  console.log(JSON.stringify(redact(value), null, 2));
}

export function printShape(label: string, value: unknown): void {
  console.log(`\n${label}:`);
  console.log(JSON.stringify(shapeOf(value), null, 2));
}

export async function runProbe(
  name: string,
  run: (args: Args) => Promise<ProbeResult>
): Promise<void> {
  const args = parseArgs();
  console.log(`SYNCIO research probe: ${name}`);
  console.log(`apply: ${boolFlag(args, "apply") ? "yes" : "no"}`);

  try {
    const result = await run(args);
    if (result.details !== undefined) printJson("details", result.details);
    console.log(`\n${result.status}: ${result.message}`);
    process.exitCode = result.status === "FAIL" ? 1 : 0;
  } catch (error) {
    if (error instanceof ProbeAbort) {
      console.log(`\n${error.status}: ${error.message}`);
      process.exitCode = error.status === "FAIL" ? 1 : 0;
      return;
    }
    console.error("\nFAIL: unhandled probe error");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function redactSecretValue(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactSecretValue);
  if (value && typeof value === "object") return "[redacted-object]";
  return "[redacted]";
}

function redactString(value: string): string {
  if (value.length <= 8) return "[redacted]";
  return `${value.slice(0, 4)}...[redacted]...${value.slice(-4)}`;
}

function looksSecret(value: string): boolean {
  if (/^Bearer\s+/i.test(value)) return true;
  if (value.length >= 32 && /^[A-Za-z0-9._~+/=-]+$/.test(value)) return true;
  return false;
}

function redactUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return value;
  }

  for (const key of Array.from(parsed.searchParams.keys())) {
    if (SECRET_KEY_PATTERN.test(key)) parsed.searchParams.set(key, "[redacted]");
  }
  return parsed.toString();
}

function loadDotEnv(path = ".env"): void {
  if (!existsSync(path)) return;

  const content = readFileSync(path, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = line.slice(0, equalsIndex).trim();
    const rawValue = line.slice(equalsIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = stripEnvQuotes(rawValue);
  }
}

function stripEnvQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\""))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
