export type PreferenceUpdateSource = "manual" | "inferred";

export type PreferenceField =
  | "displayName"
  | "interests"
  | "keywords"
  | "regions"
  | "languages"
  | "sources"
  | "avoid";

export interface PreferenceChange {
  type: "add" | "remove";
  field: PreferenceField;
  value: string;
  reason: string;
  at: string;
  by: PreferenceUpdateSource;
}

export interface PreferenceProfile {
  scopeKey: string;
  locked: boolean;
  displayName: string;
  interests: string[];
  keywords: string[];
  regions: string[];
  languages: string[];
  sources: string[];
  avoid: string[];
  updatedAt: string;
  lastUpdatedBy: PreferenceUpdateSource;
  recentChanges: PreferenceChange[];
}

export interface PreferenceProfilePatch {
  displayName?: string;
  interests?: string[];
  keywords?: string[];
  regions?: string[];
  languages?: string[];
  sources?: string[];
  avoid?: string[];
}

export interface PreferenceInferenceResult {
  displayName?: string;
  interestsToAdd?: string[];
  interestsToRemove?: string[];
  keywordsToAdd?: string[];
  keywordsToRemove?: string[];
  regionsToAdd?: string[];
  regionsToRemove?: string[];
  languagesToAdd?: string[];
  languagesToRemove?: string[];
  sourcesToAdd?: string[];
  sourcesToRemove?: string[];
  avoidToAdd?: string[];
  avoidToRemove?: string[];
  reason?: string;
  confidence?: number;
}

export const PREFERENCE_ARRAY_FIELDS = [
  "interests",
  "keywords",
  "regions",
  "languages",
  "sources",
  "avoid",
] as const;

export type PreferenceArrayField = (typeof PREFERENCE_ARRAY_FIELDS)[number];
