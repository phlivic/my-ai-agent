import { routeAgentRequest } from "@cloudflare/agents";
export { MyAgent } from "./agent";

export default {
  async fetch(request: Request, env: unknown): Promise<Response> {
    const response = await routeAgentRequest(request, env as Record<string, unknown>);
    if (response) {
      return response;
    }

    return new Response("Not Found", { status: 404 });
  },
};
