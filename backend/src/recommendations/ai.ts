import type { AppEnv } from "../env";
import type { PreferenceProfile } from "../preferences/types";
import type {
  NewsCandidate,
  RecommendationItem,
  RecommendationRule,
  SearchPlan,
  SearchPlanDraft,
} from "./types";

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const HARD_NEWS_HINT = '"news" OR "report" OR "policy" OR "market" OR "economy" OR "government" OR "technology" OR "science"';
const SOFT_EXCLUSIONS =
  'NOT (toys OR trailer OR cosplay OR merch OR merchandise OR fandom OR celebrity OR movie OR tv OR streaming OR anime OR game review)';

export async function buildSearchPlans(
  env: AppEnv,
  profile: PreferenceProfile,
  rule: RecommendationRule,
  now: Date,
  locale: string
): Promise<SearchPlan[]> {
  const fallback = buildFallbackSearchPlans(profile, rule, now);

  try {
    const result = await env.AI.run(MODEL, {
      messages: [
        {
          role: "system",
          content:
            "You build concise search plans for an external news API. Prioritize hard news and reported developments in world affairs, business, technology, science, policy, and markets. Avoid entertainment, shopping, fandom, reviews, product listings, docs, and package indexes. Return JSON only with the shape {\"queries\":[{\"query\":\"...\",\"language\":\"en\",\"sortBy\":\"publishedAt\",\"sources\":[\"source-id\"]}]}. No markdown. No commentary.",
        },
        {
          role: "user",
          content: [
            `Locale: ${locale}`,
            `Rule id: ${rule.ruleId}`,
            `Batch size: ${rule.batchSize}`,
            `Candidate target: ${rule.candidateTarget}`,
            `Lookback hours: ${rule.timeWindowHours}`,
            `Preference interests: ${profile.interests.join(", ") || "(none)"}`,
            `Preference keywords: ${profile.keywords.join(", ") || "(none)"}`,
            `Preference regions: ${profile.regions.join(", ") || "(none)"}`,
            `Preference sources: ${profile.sources.join(", ") || "(none)"}`,
            `Avoid topics: ${profile.avoid.join(", ") || "(none)"}`,
            `Current time: ${now.toISOString()}`,
            "Search language must stay English for the upstream news provider.",
            `Return up to ${rule.queryPlanLimit} search queries that are broad enough to find fresh news but still targeted to the preferences.`,
            `Bias toward hard news. Exclude entertainment, toys, merch, reviews, and fandom topics unless the user's preferences explicitly require them.`,
          ].join("\n"),
        },
      ],
    });

    const parsed = extractJsonObject<{ queries?: SearchPlanDraft[] }>(extractText(result));
    const queries = sanitizeSearchPlanDrafts(parsed?.queries, rule.queryPlanLimit);
    if (!queries.length) {
      return fallback;
    }

    return materializeSearchPlans(queries, rule, now);
  } catch (error) {
    console.error("Failed to build AI search plan:", error);
    return fallback;
  }
}

export async function rankCandidates(
  env: AppEnv,
  candidates: NewsCandidate[],
  profile: PreferenceProfile,
  rule: RecommendationRule,
  locale: string
): Promise<RecommendationItem[]> {
  const trimmedCandidates = candidates.slice(0, rule.candidateTarget);
  const fallback = buildFallbackRecommendations(trimmedCandidates, profile, rule.batchSize, locale);

  try {
    const result = await env.AI.run(MODEL, {
      messages: [
        {
          role: "system",
          content:
            "You pick the most relevant news items for a user and produce concise recommendation payloads. Prefer timely, substantive news reporting over entertainment, shopping, fandom, and promotional content unless user preferences explicitly ask for those topics. Return JSON only with the shape {\"items\":[{\"candidateId\":\"...\",\"summary\":\"...\",\"whyRecommended\":\"...\",\"prefilledPrompt\":\"...\"}]}. No markdown.",
        },
        {
          role: "user",
          content: [
            `Locale: ${locale}`,
            `Need ${rule.batchSize} recommendations for rule ${rule.ruleId}.`,
            `Preference interests: ${profile.interests.join(", ") || "(none)"}`,
            `Preference keywords: ${profile.keywords.join(", ") || "(none)"}`,
            `Preference regions: ${profile.regions.join(", ") || "(none)"}`,
            `Preference sources: ${profile.sources.join(", ") || "(none)"}`,
            `Avoid topics: ${profile.avoid.join(", ") || "(none)"}`,
            "Candidates:",
            JSON.stringify(
              trimmedCandidates.map((candidate) => ({
                candidateId: candidate.candidateId,
                title: candidate.title,
                description: candidate.description,
                sourceName: candidate.sourceName,
                publishedAt: candidate.publishedAt,
                url: candidate.url,
              }))
            ),
          ].join("\n"),
        },
      ],
    });

    const parsed = extractJsonObject<{
      items?: Array<{
        candidateId?: string;
        summary?: string;
        whyRecommended?: string;
        prefilledPrompt?: string;
      }>;
    }>(extractText(result));

    const mapped = new Map(trimmedCandidates.map((candidate) => [candidate.candidateId, candidate]));
    const items: RecommendationItem[] = [];

    for (const entry of parsed?.items ?? []) {
      if (!entry.candidateId || items.length >= rule.batchSize) {
        continue;
      }

      const candidate = mapped.get(entry.candidateId);
      if (!candidate) {
        continue;
      }

      items.push({
        id: crypto.randomUUID(),
        title: candidate.title,
        summary: compactText(entry.summary) || summarizeCandidate(candidate),
        whyRecommended:
          compactText(entry.whyRecommended) || buildRecommendationReason(candidate, profile, locale),
        prefilledPrompt:
          compactText(entry.prefilledPrompt) || buildPrefillPrompt(candidate.title, locale),
        sources: [{ name: candidate.sourceName, url: candidate.url }],
        sourceSnapshot: candidate,
      });
    }

    if (!items.length) {
      return fallback;
    }

    return fillRecommendationGaps(items, trimmedCandidates, profile, rule.batchSize, locale);
  } catch (error) {
    console.error("Failed to rank recommendation candidates:", error);
    return fallback;
  }
}

export function dedupeCandidates(candidates: NewsCandidate[]): NewsCandidate[] {
  const seen = new Set<string>();
  const deduped: NewsCandidate[] = [];

  for (const candidate of candidates) {
    const key = `${candidate.url}|${candidate.title.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
}

function materializeSearchPlans(drafts: SearchPlanDraft[], rule: RecommendationRule, now: Date): SearchPlan[] {
  const from = new Date(now.getTime() - rule.timeWindowHours * 60 * 60 * 1000).toISOString();
  const to = now.toISOString();
  const pageSize = Math.max(rule.batchSize * 2, Math.ceil(rule.candidateTarget / Math.max(1, drafts.length)));

  return drafts.slice(0, rule.queryPlanLimit).map((draft) => ({
    query: draft.query,
    language: draft.language,
    sortBy: draft.sortBy ?? "publishedAt",
    sources: draft.sources?.slice(0, 5),
    from,
    to,
    pageSize,
  }));
}

function buildFallbackSearchPlans(
  profile: PreferenceProfile,
  rule: RecommendationRule,
  now: Date
): SearchPlan[] {
  const from = new Date(now.getTime() - rule.timeWindowHours * 60 * 60 * 1000).toISOString();
  const to = now.toISOString();
  const languages = ["en"];
  const primaryTerms = [...profile.interests, ...profile.keywords, ...profile.regions]
    .map((term) => maybeQuote(term))
    .slice(0, 6);
  const preferenceQuery = primaryTerms.length ? primaryTerms.join(" OR ") : "AI OR technology OR business OR markets";
  const avoidQuery = buildAvoidExclusionQuery(profile.avoid);
  const primaryQuery = `(${preferenceQuery}) AND (${HARD_NEWS_HINT}) ${SOFT_EXCLUSIONS}${avoidQuery}`;
  const secondaryQuery = profile.keywords.length
    ? `(${profile.keywords.map((term) => maybeQuote(term)).join(" OR ")}) AND (${HARD_NEWS_HINT}) ${SOFT_EXCLUSIONS}${avoidQuery}`
    : `("world" OR "business" OR "technology" OR "science" OR "policy" OR "markets") AND (${HARD_NEWS_HINT}) ${SOFT_EXCLUSIONS}`;

  return languages.map((language, index) => ({
    query: index === 0 ? primaryQuery : secondaryQuery,
    language,
    sortBy: index === 0 ? "publishedAt" : "relevancy",
    sources: profile.sources.slice(0, 5),
    from,
    to,
    pageSize: Math.max(rule.batchSize * 2, Math.ceil(rule.candidateTarget / languages.length)),
  }));
}

function sanitizeSearchPlanDrafts(value: SearchPlanDraft[] | undefined, maxLength: number): SearchPlanDraft[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is SearchPlanDraft => typeof item?.query === "string")
    .map((item) => ({
      query: compactText(item.query),
      language: "en",
      sortBy: item.sortBy,
      sources: Array.isArray(item.sources)
        ? item.sources.filter((source): source is string => typeof source === "string").map((source) => source.trim())
        : undefined,
    }))
    .filter((item) => item.query)
    .slice(0, maxLength);
}

function buildFallbackRecommendations(
  candidates: NewsCandidate[],
  profile: PreferenceProfile,
  batchSize: number,
  locale: string
): RecommendationItem[] {
  return candidates.slice(0, batchSize).map((candidate) => ({
    id: crypto.randomUUID(),
    title: candidate.title,
    summary: summarizeCandidate(candidate),
    whyRecommended: buildRecommendationReason(candidate, profile, locale),
    prefilledPrompt: buildPrefillPrompt(candidate.title, locale),
    sources: [{ name: candidate.sourceName, url: candidate.url }],
    sourceSnapshot: candidate,
  }));
}

function fillRecommendationGaps(
  items: RecommendationItem[],
  candidates: NewsCandidate[],
  profile: PreferenceProfile,
  batchSize: number,
  locale: string
): RecommendationItem[] {
  const seenTitles = new Set(items.map((item) => item.title.toLowerCase()));
  for (const candidate of candidates) {
    if (items.length >= batchSize) {
      break;
    }
    if (seenTitles.has(candidate.title.toLowerCase())) {
      continue;
    }
    items.push({
      id: crypto.randomUUID(),
      title: candidate.title,
      summary: summarizeCandidate(candidate),
      whyRecommended: buildRecommendationReason(candidate, profile, locale),
      prefilledPrompt: buildPrefillPrompt(candidate.title, locale),
      sources: [{ name: candidate.sourceName, url: candidate.url }],
      sourceSnapshot: candidate,
    });
    seenTitles.add(candidate.title.toLowerCase());
  }
  return items;
}

function summarizeCandidate(candidate: NewsCandidate): string {
  return compactText(candidate.description) || `A recent article from ${candidate.sourceName}.`;
}

function buildRecommendationReason(
  candidate: NewsCandidate,
  profile: PreferenceProfile,
  locale: string
): string {
  const hint = profile.interests[0] || profile.keywords[0] || profile.regions[0];
  if (locale.toLowerCase().startsWith("zh")) {
    return hint
      ? `这条新闻和你关注的“${hint}”更相关。`
      : `这是一条较新的新闻，适合先快速了解背景。`;
  }
  return hint
    ? `This story is more aligned with your interest in ${hint}.`
    : "This is a recent story that looks worth understanding first.";
}

function buildAvoidExclusionQuery(avoid: string[]): string {
  const normalized = avoid.map((term) => maybeQuote(term)).filter(Boolean).slice(0, 4);
  if (!normalized.length) {
    return "";
  }
  return ` NOT (${normalized.join(" OR ")})`;
}

function buildPrefillPrompt(title: string, locale: string): string {
  if (locale.toLowerCase().startsWith("zh")) {
    return `请帮我解释这条新闻的背景、关键事实、影响和不同观点：${title}`;
  }
  return `Please explain the background, key facts, impact, and different viewpoints for this news story: ${title}`;
}

function maybeQuote(value: string): string {
  const trimmed = compactText(value);
  if (!trimmed) {
    return "";
  }
  return /\s/.test(trimmed) ? `"${trimmed}"` : trimmed;
}

function compactText(value: string | undefined): string {
  return value?.trim() || "";
}

function extractText(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  if (typeof (result as { response?: unknown })?.response === "string") {
    return (result as { response: string }).response;
  }
  if (typeof (result as { result?: { response?: unknown } })?.result?.response === "string") {
    return (result as { result: { response: string } }).result.response;
  }
  return "";
}

function extractJsonObject<T>(text: string): T | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || trimmed;

  for (const sample of [candidate, sliceBetween(candidate, "{", "}"), sliceBetween(candidate, "[", "]")]) {
    if (!sample) {
      continue;
    }
    try {
      return JSON.parse(sample) as T;
    } catch {
      continue;
    }
  }

  return null;
}

function sliceBetween(value: string, startToken: string, endToken: string): string | null {
  const start = value.indexOf(startToken);
  const end = value.lastIndexOf(endToken);
  if (start === -1 || end === -1 || end < start) {
    return null;
  }
  return value.slice(start, end + 1);
}
