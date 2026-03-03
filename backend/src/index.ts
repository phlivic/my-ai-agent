import { routeAgentRequest } from "@cloudflare/agents";
import type { AppEnv } from "./env";
import { DEFAULT_SCOPE_KEY } from "./recommendations/rules";
export { MyAgent } from "./agent";
export { RecommendationStore } from "./recommendations/store";

const API_PATH_PREFIX = "/api/";

export default {
  async fetch(request: Request, env: AppEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith(API_PATH_PREFIX)) {
      if (request.method === "OPTIONS") {
        return withCors(new Response(null, { status: 204 }));
      }

      return withCors(await routeRecommendationRequest(request, env));
    }

    const response = await routeAgentRequest(request, env as Record<string, unknown>);
    if (response) {
      return response;
    }

    return new Response("Not Found", { status: 404 });
  },
};

async function routeRecommendationRequest(request: Request, env: AppEnv): Promise<Response> {
  const scopeKey = resolveScopeKey(request);
  const id = env.RECOMMENDATION_STORE.idFromName(scopeKey);
  const stub = env.RECOMMENDATION_STORE.get(id);
  const headers = new Headers(request.headers);
  headers.set("x-recommendation-scope", scopeKey);

  return stub.fetch(new Request(request, { headers }));
}

function resolveScopeKey(request: Request): string {
  return request.headers.get("x-user-scope")?.trim() || DEFAULT_SCOPE_KEY;
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET, PATCH, POST, OPTIONS");
  headers.set("access-control-allow-headers", "content-type, x-user-scope");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
