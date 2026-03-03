export interface AiBinding {
  run: (
    model: string,
    input: {
      messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
      max_tokens?: number;
    }
  ) => Promise<{ response?: string } | { result?: { response?: string } } | string>;
}

export interface AppEnv {
  AI: AiBinding;
  myAgent: DurableObjectNamespace;
  RECOMMENDATION_STORE: DurableObjectNamespace;
  NEWS_PROVIDER?: string;
  NEWSAPI_API_KEY?: string;
  DEFAULT_TIMEZONE?: string;
  DEFAULT_LOCALE?: string;
  RECOMMENDATION_BATCH_SIZE?: string;
}
