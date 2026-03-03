export type NewsProviderName = "newsapi" | "placeholder";

export interface RecommendationFreshness {
  provider: NewsProviderName;
  mode: "delayed" | "realtime" | "unknown";
  expectedDelayHours: number | null;
}

export interface RecommendationRule {
  ruleId: string;
  enabled: boolean;
  provider: NewsProviderName;
  batchSize: number;
  candidateTarget: number;
  timeWindowHours: number;
  queryPlanLimit: number;
  locale: string;
  deliveryMode: "prefill";
  searchMode: "llm-plan-then-fetch";
}

export type NewsSortBy = "publishedAt" | "relevancy" | "popularity";

export interface SearchPlanDraft {
  query: string;
  language?: string;
  sortBy?: NewsSortBy;
  sources?: string[];
}

export interface SearchPlan extends SearchPlanDraft {
  pageSize: number;
  from: string;
  to: string;
}

export interface NewsCandidate {
  candidateId: string;
  title: string;
  description: string;
  url: string;
  sourceName: string;
  publishedAt: string;
  provider: NewsProviderName;
  language?: string;
}

export interface RecommendationSource {
  name: string;
  url: string;
}

export interface RecommendationItem {
  id: string;
  title: string;
  summary: string;
  whyRecommended: string;
  prefilledPrompt: string;
  sources: RecommendationSource[];
  sourceSnapshot: NewsCandidate;
}

export interface StoredRecommendationBatch {
  batchId: string;
  ruleId: string;
  dateKey: string;
  createdAt: string;
  freshness: RecommendationFreshness;
  total: number;
  items: RecommendationItem[];
}

export interface RecommendationCursor {
  batchId: string;
  nextIndex: number;
  updatedAt: string;
}

export interface NextRecommendationRequest {
  timezone?: string;
  locale?: string;
}

export interface RecommendationRuleStateResponse {
  ruleId: string;
  enabled: boolean;
  provider: NewsProviderName;
  batchSize: number;
  dateKey: string;
  nextIndex: number | null;
  total: number | null;
  hasActiveBatch: boolean;
}
