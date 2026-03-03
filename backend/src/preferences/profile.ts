import type {
  PreferenceArrayField,
  PreferenceChange,
  PreferenceInferenceResult,
  PreferenceProfile,
  PreferenceProfilePatch,
  PreferenceUpdateSource,
} from "./types";
import { PREFERENCE_ARRAY_FIELDS } from "./types";

const DEFAULT_DISPLAY_NAME = "Guest";
const MAX_RECENT_CHANGES = 12;
const MAX_AUTO_ADDITIONS_PER_FIELD = 3;
const MAX_AUTO_REMOVALS_PER_FIELD = 2;
const MIN_AUTO_ADD_CONFIDENCE = 0.45;
const MIN_AUTO_REMOVE_CONFIDENCE = 0.6;
const MIN_DISPLAY_NAME_CONFIDENCE = 0.7;

export function createDefaultPreferenceProfile(scopeKey: string): PreferenceProfile {
  return {
    scopeKey,
    locked: false,
    displayName: DEFAULT_DISPLAY_NAME,
    interests: [],
    keywords: [],
    regions: [],
    languages: ["English"],
    sources: [],
    avoid: [],
    updatedAt: new Date().toISOString(),
    lastUpdatedBy: "manual",
    recentChanges: [],
  };
}

export function normalizePreferencePatch(input: Partial<PreferenceProfilePatch> | undefined): PreferenceProfilePatch {
  return {
    displayName: input?.displayName === undefined ? undefined : normalizeDisplayName(input.displayName),
    interests: normalizeOptionalArray(input?.interests, "interests"),
    keywords: normalizeOptionalArray(input?.keywords, "keywords"),
    regions: normalizeOptionalArray(input?.regions, "regions"),
    languages: normalizeOptionalArray(input?.languages, "languages"),
    sources: normalizeOptionalArray(input?.sources, "sources"),
    avoid: normalizeOptionalArray(input?.avoid, "avoid"),
  };
}

export function applyManualProfilePatch(
  current: PreferenceProfile,
  patch: PreferenceProfilePatch
): PreferenceProfile {
  const next: PreferenceProfile = {
    ...current,
    displayName: patch.displayName === undefined ? current.displayName : patch.displayName || DEFAULT_DISPLAY_NAME,
    interests: patch.interests === undefined ? current.interests : patch.interests,
    keywords: patch.keywords === undefined ? current.keywords : patch.keywords,
    regions: patch.regions === undefined ? current.regions : patch.regions,
    languages: patch.languages === undefined ? current.languages : ensureDefaultLanguage(patch.languages),
    sources: patch.sources === undefined ? current.sources : patch.sources,
    avoid: patch.avoid === undefined ? current.avoid : patch.avoid,
    updatedAt: new Date().toISOString(),
    lastUpdatedBy: "manual",
    recentChanges: current.recentChanges,
  };

  next.recentChanges = prependChanges(current, next, "manual", "Manually updated preferences.");
  return next;
}

export function applyLockState(current: PreferenceProfile, locked: boolean): PreferenceProfile {
  return {
    ...current,
    locked,
    updatedAt: new Date().toISOString(),
    lastUpdatedBy: "manual",
  };
}

export function applyInferredProfileUpdate(
  current: PreferenceProfile,
  update: PreferenceInferenceResult
): PreferenceProfile {
  const confidence = clampConfidence(update.confidence);
  if (confidence < MIN_AUTO_ADD_CONFIDENCE) {
    return current;
  }

  let next: PreferenceProfile = {
    ...current,
    recentChanges: current.recentChanges,
  };
  const updateMap = update as Record<string, unknown>;

  if (update.displayName && confidence >= MIN_DISPLAY_NAME_CONFIDENCE) {
    const nextDisplayName = normalizeDisplayName(update.displayName);
    if (nextDisplayName && nextDisplayName !== next.displayName) {
      next = {
        ...next,
        displayName: nextDisplayName,
      };
    }
  }

  for (const field of PREFERENCE_ARRAY_FIELDS) {
    if (field === "languages") {
      continue;
    }

    const additions = boundedNormalizedArray(
      Array.isArray(updateMap[`${field}ToAdd`]) ? (updateMap[`${field}ToAdd`] as string[]) : undefined,
      field,
      MAX_AUTO_ADDITIONS_PER_FIELD
    );
    const removals =
      confidence >= MIN_AUTO_REMOVE_CONFIDENCE
        ? boundedNormalizedArray(
            Array.isArray(updateMap[`${field}ToRemove`]) ? (updateMap[`${field}ToRemove`] as string[]) : undefined,
            field,
            MAX_AUTO_REMOVALS_PER_FIELD
          )
        : [];

    if (additions.length || removals.length) {
      next = {
        ...next,
        [field]: mergeArrayField(next[field], additions, removals, field),
      };
    }
  }

  if (!profilesDiffer(current, next)) {
    return current;
  }

  next = {
    ...next,
    updatedAt: new Date().toISOString(),
    lastUpdatedBy: "inferred",
  };
  next.recentChanges = prependChanges(
    current,
    next,
    "inferred",
    update.reason?.trim() || "Updated from recent user message."
  );

  return next;
}

function prependChanges(
  previous: PreferenceProfile,
  next: PreferenceProfile,
  by: PreferenceUpdateSource,
  reason: string
): PreferenceChange[] {
  const timestamp = next.updatedAt;
  const changes: PreferenceChange[] = [];

  if (previous.displayName !== next.displayName) {
    changes.push({
      type: next.displayName ? "add" : "remove",
      field: "displayName",
      value: next.displayName,
      reason,
      at: timestamp,
      by,
    });
  }

  for (const field of PREFERENCE_ARRAY_FIELDS) {
    const previousValues = new Set(previous[field].map((value) => value.toLowerCase()));
    const nextValues = new Set(next[field].map((value) => value.toLowerCase()));

    for (const value of next[field]) {
      if (!previousValues.has(value.toLowerCase())) {
        changes.push({
          type: "add",
          field,
          value,
          reason,
          at: timestamp,
          by,
        });
      }
    }

    for (const value of previous[field]) {
      if (!nextValues.has(value.toLowerCase())) {
        changes.push({
          type: "remove",
          field,
          value,
          reason,
          at: timestamp,
          by,
        });
      }
    }
  }

  return [...changes, ...previous.recentChanges].slice(0, MAX_RECENT_CHANGES);
}

function mergeArrayField(
  current: string[],
  additions: string[],
  removals: string[],
  field: PreferenceArrayField
): string[] {
  const normalizedCurrent = normalizeArray(current, field);
  const removalSet = new Set(removals.map((value) => value.toLowerCase()));
  const filtered = normalizedCurrent.filter((value) => !removalSet.has(value.toLowerCase()));
  const merged = normalizeArray([...filtered, ...additions], field);
  return field === "languages" ? ensureDefaultLanguage(merged) : merged;
}

function ensureDefaultLanguage(values: string[]): string[] {
  return values.length ? values : ["English"];
}

function boundedNormalizedArray(
  values: string[] | undefined,
  field: PreferenceArrayField,
  maxItems: number
): string[] {
  return normalizeArray(values, field).slice(0, maxItems);
}

function normalizeOptionalArray(values: unknown, field: PreferenceArrayField): string[] | undefined {
  if (values === undefined) {
    return undefined;
  }
  return normalizeArray(values, field);
}

function normalizeArray(values: unknown, field: PreferenceArrayField): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const normalized = normalizeFieldValue(field, value);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function normalizeDisplayName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized || "";
}

function normalizeFieldValue(field: PreferenceArrayField, value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return "";
  }

  if (field === "regions") {
    return trimmed.toUpperCase();
  }

  if (field === "languages") {
    return trimmed
      .split(" ")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  }

  return trimmed;
}

function clampConfidence(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function profilesDiffer(previous: PreferenceProfile, next: PreferenceProfile): boolean {
  if (previous.displayName !== next.displayName) {
    return true;
  }

  return PREFERENCE_ARRAY_FIELDS.some((field) => !arraysEqual(previous[field], next[field]));
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}
