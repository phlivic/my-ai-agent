import type { AppEnv } from "../env";
import type {
  NewsCandidate,
  NewsProviderName,
  RecommendationFreshness,
  SearchPlan,
} from "./types";

export interface NewsProvider {
  name: NewsProviderName;
  freshness: RecommendationFreshness;
  search(plan: SearchPlan): Promise<NewsCandidate[]>;
}

interface NewsApiArticle {
  title?: string;
  description?: string;
  url?: string;
  publishedAt?: string;
  source?: { name?: string };
}

interface NewsApiSearchResponse {
  status?: string;
  message?: string;
  articles?: NewsApiArticle[];
}

const EXCLUDED_DOMAINS = [
  "pypi.org",
  "test.pypi.org",
  "npmjs.com",
  "registry.npmjs.org",
  "github.com",
  "raw.githubusercontent.com",
  "gitlab.com",
  "bitbucket.org",
  "readthedocs.io",
  "developer.mozilla.org",
  "docs.python.org",
  "docs.npmjs.com",
  "stackoverflow.com",
  "stackexchange.com",
  "huggingface.co",
  "comicbook.com",
  "screenrant.com",
  "cbr.com",
  "gamesradar.com",
  "ign.com",
];

const EXCLUDED_TITLE_TERMS = [
  "toy",
  "toys",
  "trailer",
  "merch",
  "merchandise",
  "cosplay",
  "fandom",
  "review",
  "episode",
  "season finale",
  "box office",
];

class NewsApiProvider implements NewsProvider {
  readonly name = "newsapi" as const;
  readonly freshness: RecommendationFreshness = {
    provider: "newsapi",
    mode: "delayed",
    expectedDelayHours: 24,
  };

  constructor(private readonly env: AppEnv) {}

  async search(plan: SearchPlan): Promise<NewsCandidate[]> {
    if (!this.env.NEWSAPI_API_KEY) {
      throw new Error("NEWSAPI_API_KEY is not configured.");
    }

    const params = new URLSearchParams({
      q: plan.query,
      apiKey: this.env.NEWSAPI_API_KEY,
      pageSize: String(Math.min(100, Math.max(1, plan.pageSize))),
      sortBy: plan.sortBy ?? "publishedAt",
      searchIn: "title,description",
      from: plan.from,
      to: plan.to,
      excludeDomains: EXCLUDED_DOMAINS.join(","),
    });

    if (plan.language) {
      params.set("language", plan.language);
    }
    if (plan.sources?.length) {
      params.set("sources", plan.sources.join(","));
    }

    const response = await fetch(`https://newsapi.org/v2/everything?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "my-ai-agent/0.1 (+local-dev)",
        "X-Api-Key": this.env.NEWSAPI_API_KEY,
      },
    });

    const payload = (await response.json()) as NewsApiSearchResponse;
    if (!response.ok || payload.status === "error") {
      throw new Error(payload.message || `NewsAPI request failed with status ${response.status}`);
    }

    return (payload.articles ?? [])
      .filter((article) => article.title && article.url)
      .filter((article) => isLikelyNewsArticle(article.url!, article.source?.name, article.title))
      .map((article) => ({
        candidateId: crypto.randomUUID(),
        title: article.title!.trim(),
        description: article.description?.trim() || "",
        url: article.url!,
        sourceName: article.source?.name?.trim() || "Unknown source",
        publishedAt: article.publishedAt || new Date().toISOString(),
        provider: this.name,
        language: plan.language,
      }));
  }
}

function isLikelyNewsArticle(url: string, sourceName: string | undefined, title: string | undefined): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (isBlockedHostname(hostname)) {
      return false;
    }
  } catch {
    return false;
  }

  const normalizedSource = sourceName?.trim().toLowerCase() || "";
  if (
    normalizedSource.includes("pypi") ||
    normalizedSource.includes("github") ||
    normalizedSource.includes("gitlab") ||
    normalizedSource.includes("stackoverflow") ||
    normalizedSource.includes("read the docs")
  ) {
    return false;
  }

  const normalizedTitle = title?.trim().toLowerCase() || "";
  if (EXCLUDED_TITLE_TERMS.some((term) => normalizedTitle.includes(term))) {
    return false;
  }

  return true;
}

function isBlockedHostname(hostname: string): boolean {
  return EXCLUDED_DOMAINS.some((blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`));
}

class PlaceholderNewsProvider implements NewsProvider {
  readonly name = "placeholder" as const;
  readonly freshness: RecommendationFreshness = {
    provider: "placeholder",
    mode: "unknown",
    expectedDelayHours: null,
  };

  async search(): Promise<NewsCandidate[]> {
    return [];
  }
}

export function createNewsProvider(env: AppEnv, providerName: NewsProviderName): NewsProvider {
  if (providerName === "placeholder") {
    return new PlaceholderNewsProvider();
  }
  return new NewsApiProvider(env);
}
