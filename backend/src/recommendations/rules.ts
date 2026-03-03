import type { AppEnv } from "../env";
import type { NewsProviderName, RecommendationRule } from "./types";

export const DEFAULT_SCOPE_KEY = "default-user";
export const DEFAULT_RULE_ID = "daily-personal-news";
export const FALLBACK_TIMEZONE = "America/Chicago";
export const FALLBACK_LOCALE = "en-US";

export function getRecommendationRule(ruleId: string, env: AppEnv): RecommendationRule | null {
  if (ruleId !== DEFAULT_RULE_ID) {
    return null;
  }

  return {
    ruleId,
    enabled: true,
    provider: getConfiguredProvider(env),
    batchSize: clampInteger(env.RECOMMENDATION_BATCH_SIZE, 3, 1, 10),
    candidateTarget: 12,
    timeWindowHours: 48,
    queryPlanLimit: 2,
    locale: env.DEFAULT_LOCALE?.trim() || FALLBACK_LOCALE,
    deliveryMode: "prefill",
    searchMode: "llm-plan-then-fetch",
  };
}

export function getDefaultTimezone(env: AppEnv): string {
  return env.DEFAULT_TIMEZONE?.trim() || FALLBACK_TIMEZONE;
}

export function getDefaultLocale(env: AppEnv): string {
  return env.DEFAULT_LOCALE?.trim() || FALLBACK_LOCALE;
}

function getConfiguredProvider(env: AppEnv): NewsProviderName {
  if (env.NEWS_PROVIDER === "placeholder") {
    return "placeholder";
  }
  return "newsapi";
}

function clampInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}
