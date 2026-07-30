export const COMPANION_CONTRACT_VERSION = 1;
export const DEFAULT_COMPLETION_THRESHOLD = 80;
export const MAX_PREVIEW_OBSERVATIONS = 100;

export type CompanionMediaType = "movie" | "episode";

export interface CompanionObservation {
  contractVersion: typeof COMPANION_CONTRACT_VERSION;
  provider: string;
  sourceItemId: string;
  sourceShowId: string | null;
  mediaType: CompanionMediaType;
  title: string;
  year: number | null;
  showTitle: string | null;
  season: number | null;
  episode: number | null;
  absoluteEpisode: number | null;
  progressPercent: number | null;
  platformMarkedCompleted: boolean | null;
  watchedAt: string | null;
  durationSeconds: number | null;
}

export type ObservationDisposition = "candidate" | "review" | "excluded";

export interface ObservationAssessment {
  sourceItemId: string;
  disposition: ObservationDisposition;
  reason:
    | "completed-by-platform"
    | "completion-threshold-met"
    | "below-completion-threshold"
    | "platform-marked-incomplete"
    | "conflicting-completion-signals"
    | "missing-completion-evidence"
    | "missing-watched-date"
    | "missing-episode-coordinates";
}

export interface ObservationPreview {
  contractVersion: typeof COMPANION_CONTRACT_VERSION;
  apply: false;
  completionThreshold: number;
  counts: Record<ObservationDisposition, number>;
  items: ObservationAssessment[];
}

const OBSERVATION_KEYS = new Set([
  "contractVersion",
  "provider",
  "sourceItemId",
  "sourceShowId",
  "mediaType",
  "title",
  "year",
  "showTitle",
  "season",
  "episode",
  "absoluteEpisode",
  "progressPercent",
  "platformMarkedCompleted",
  "watchedAt",
  "durationSeconds"
]);

export function parseObservationBatch(value: unknown): CompanionObservation[] {
  const body = recordValue(value, "body");
  assertOnlyKeys(body, new Set(["observations"]), "body");
  if (!Array.isArray(body.observations)) throw new Error("observations must be an array.");
  if (body.observations.length > MAX_PREVIEW_OBSERVATIONS) {
    throw new Error(`observations cannot contain more than ${MAX_PREVIEW_OBSERVATIONS} items.`);
  }
  return body.observations.map((item, index) => parseObservation(item, `observations[${index}]`));
}

export function previewObservations(
  observations: CompanionObservation[],
  completionThreshold = DEFAULT_COMPLETION_THRESHOLD
): ObservationPreview {
  if (!Number.isFinite(completionThreshold) || completionThreshold < 1 || completionThreshold > 100) {
    throw new Error("completionThreshold must be between 1 and 100.");
  }
  const items = observations.map((observation) => assessObservation(observation, completionThreshold));
  return {
    contractVersion: COMPANION_CONTRACT_VERSION,
    apply: false,
    completionThreshold,
    counts: {
      candidate: items.filter((item) => item.disposition === "candidate").length,
      review: items.filter((item) => item.disposition === "review").length,
      excluded: items.filter((item) => item.disposition === "excluded").length
    },
    items
  };
}

function assessObservation(
  observation: CompanionObservation,
  completionThreshold: number
): ObservationAssessment {
  const base = { sourceItemId: observation.sourceItemId };
  const progressComplete = observation.progressPercent !== null
    && observation.progressPercent >= completionThreshold;

  if (observation.platformMarkedCompleted === false && progressComplete) {
    return { ...base, disposition: "review", reason: "conflicting-completion-signals" };
  }
  if (observation.platformMarkedCompleted === false) {
    return { ...base, disposition: "excluded", reason: "platform-marked-incomplete" };
  }
  if (observation.platformMarkedCompleted !== true) {
    if (observation.progressPercent !== null && !progressComplete) {
      return { ...base, disposition: "excluded", reason: "below-completion-threshold" };
    }
    if (!progressComplete) {
      return { ...base, disposition: "review", reason: "missing-completion-evidence" };
    }
  }
  if (!observation.watchedAt) {
    return { ...base, disposition: "review", reason: "missing-watched-date" };
  }
  if (
    observation.mediaType === "episode"
    && observation.absoluteEpisode === null
    && (observation.season === null || observation.episode === null)
  ) {
    return { ...base, disposition: "review", reason: "missing-episode-coordinates" };
  }
  return {
    ...base,
    disposition: "candidate",
    reason: observation.platformMarkedCompleted === true
      ? "completed-by-platform"
      : "completion-threshold-met"
  };
}

function parseObservation(value: unknown, label: string): CompanionObservation {
  const item = recordValue(value, label);
  assertOnlyKeys(item, OBSERVATION_KEYS, label);
  const contractVersion = integerValue(item.contractVersion, `${label}.contractVersion`);
  if (contractVersion !== COMPANION_CONTRACT_VERSION) {
    throw new Error(`${label}.contractVersion must be ${COMPANION_CONTRACT_VERSION}.`);
  }
  const mediaType = stringValue(item.mediaType, `${label}.mediaType`);
  if (mediaType !== "movie" && mediaType !== "episode") {
    throw new Error(`${label}.mediaType must be movie or episode.`);
  }
  return {
    contractVersion,
    provider: constrainedString(item.provider, `${label}.provider`, 2, 40, /^[a-z0-9-]+$/),
    sourceItemId: constrainedString(item.sourceItemId, `${label}.sourceItemId`, 1, 200),
    sourceShowId: nullableConstrainedString(item.sourceShowId, `${label}.sourceShowId`, 1, 200),
    mediaType,
    title: constrainedString(item.title, `${label}.title`, 1, 300),
    year: nullableInteger(item.year, `${label}.year`, 1870, 2200),
    showTitle: nullableConstrainedString(item.showTitle, `${label}.showTitle`, 1, 300),
    season: nullableInteger(item.season, `${label}.season`, 0, 1000),
    episode: nullableInteger(item.episode, `${label}.episode`, 0, 100000),
    absoluteEpisode: nullableInteger(item.absoluteEpisode, `${label}.absoluteEpisode`, 1, 100000),
    progressPercent: nullableNumber(item.progressPercent, `${label}.progressPercent`, 0, 100),
    platformMarkedCompleted: nullableBoolean(
      item.platformMarkedCompleted,
      `${label}.platformMarkedCompleted`
    ),
    watchedAt: nullableIsoDate(item.watchedAt, `${label}.watchedAt`),
    durationSeconds: nullableInteger(item.durationSeconds, `${label}.durationSeconds`, 1, 86400)
  };
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: Set<string>, label: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new Error(`${label} contains unsupported fields: ${unexpected.join(", ")}.`);
  }
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  return value;
}

function constrainedString(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  pattern?: RegExp
): string {
  const result = stringValue(value, label).trim();
  if (result.length < minimum || result.length > maximum || (pattern && !pattern.test(result))) {
    throw new Error(`${label} is invalid.`);
  }
  return result;
}

function nullableConstrainedString(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number
): string | null {
  return value === null ? null : constrainedString(value, label, minimum, maximum);
}

function integerValue(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer.`);
  }
  return value;
}

function nullableInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number
): number | null {
  if (value === null) return null;
  const result = integerValue(value, label);
  if (result < minimum || result > maximum) throw new Error(`${label} is out of range.`);
  return result;
}

function nullableNumber(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number
): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is out of range.`);
  }
  return value;
}

function nullableBoolean(value: unknown, label: string): boolean | null {
  if (value === null) return null;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean or null.`);
  return value;
}

function nullableIsoDate(value: unknown, label: string): string | null {
  if (value === null) return null;
  const result = stringValue(value, label);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} must be an ISO date.`);
  return new Date(result).toISOString();
}
