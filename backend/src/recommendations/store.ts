import type { AppEnv } from "../env";
import {
  applyInferredProfileUpdate,
  applyLockState,
  applyManualProfilePatch,
  createDefaultPreferenceProfile,
  normalizePreferencePatch,
} from "../preferences/profile";
import type {
  PreferenceInferenceResult,
  PreferenceProfile,
  PreferenceProfilePatch,
} from "../preferences/types";
import { buildSearchPlans, dedupeCandidates, rankCandidates } from "./ai";
import { createNewsProvider } from "./providers";
import {
  DEFAULT_SCOPE_KEY,
  getDefaultLocale,
  getDefaultTimezone,
  getRecommendationRule,
} from "./rules";
import type {
  NextRecommendationRequest,
  RecommendationCursor,
  RecommendationRuleStateResponse,
  StoredRecommendationBatch,
} from "./types";

const PROFILE_KEY = "profile:v2";

export class RecommendationStore {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: AppEnv
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const scopeKey = request.headers.get("x-recommendation-scope") || DEFAULT_SCOPE_KEY;

    if (request.method === "GET" && url.pathname === "/api/profile/preferences") {
      return this.json({
        scopeKey,
        profile: await this.getProfile(scopeKey),
      });
    }

    if (request.method === "PATCH" && url.pathname === "/api/profile/preferences") {
      return this.state.blockConcurrencyWhile(async () => this.handlePatchProfile(request, scopeKey));
    }

    if (request.method === "PATCH" && url.pathname === "/api/profile/preferences/lock") {
      return this.state.blockConcurrencyWhile(async () => this.handlePatchLock(request, scopeKey));
    }

    if (request.method === "PATCH" && url.pathname === "/api/profile/preferences/infer") {
      return this.state.blockConcurrencyWhile(async () => this.handlePatchInference(request, scopeKey));
    }

    const nextMatch = url.pathname.match(/^\/api\/recommendation-rules\/([^/]+)\/next$/);
    if (request.method === "POST" && nextMatch) {
      return this.state.blockConcurrencyWhile(async () =>
        this.handleNextRecommendation(nextMatch[1], request, scopeKey)
      );
    }

    const ruleMatch = url.pathname.match(/^\/api\/recommendation-rules\/([^/]+)$/);
    if (request.method === "GET" && ruleMatch) {
      return this.handleGetRuleState(ruleMatch[1], url, scopeKey);
    }

    return this.error("NOT_FOUND", "Recommendation endpoint not found.", 404);
  }

  private async handlePatchProfile(request: Request, scopeKey: string): Promise<Response> {
    const body = await readJsonBody<Partial<PreferenceProfilePatch>>(request);
    const patch = normalizePreferencePatch(body);
    const current = await this.getProfile(scopeKey);
    const next = applyManualProfilePatch(current, patch);
    await this.putProfile(next);

    return this.json({
      scopeKey,
      profile: next,
    });
  }

  private async handlePatchLock(request: Request, scopeKey: string): Promise<Response> {
    const body = await readJsonBody<{ locked?: unknown }>(request);
    const current = await this.getProfile(scopeKey);
    const next = applyLockState(current, Boolean(body.locked));
    await this.putProfile(next);

    return this.json({
      scopeKey,
      profile: next,
    });
  }

  private async handlePatchInference(request: Request, scopeKey: string): Promise<Response> {
    const body = await readJsonBody<PreferenceInferenceResult>(request);
    const current = await this.getProfile(scopeKey);
    const next = current.locked ? current : applyInferredProfileUpdate(current, body);

    if (next !== current) {
      await this.putProfile(next);
    }

    return this.json({
      scopeKey,
      profile: next,
    });
  }

  private async handleGetRuleState(ruleId: string, url: URL, scopeKey: string): Promise<Response> {
    const rule = getRecommendationRule(ruleId, this.env);
    if (!rule) {
      return this.error("INVALID_RULE", `Unknown recommendation rule: ${ruleId}`, 404);
    }

    const timezone = url.searchParams.get("timezone") || getDefaultTimezone(this.env);
    const dateKey = getDateKey(new Date(), timezone);
    const cursor = await this.getCursor(ruleId, dateKey);
    const batch = cursor ? await this.getBatch(cursor.batchId) : null;

    const response: RecommendationRuleStateResponse = {
      ruleId,
      enabled: rule.enabled,
      provider: rule.provider,
      batchSize: rule.batchSize,
      dateKey,
      nextIndex: cursor?.nextIndex ?? null,
      total: batch?.total ?? null,
      hasActiveBatch: Boolean(batch && cursor && cursor.nextIndex <= batch.total),
    };

    return this.json({
      scopeKey,
      rule: response,
    });
  }

  private async handleNextRecommendation(
    ruleId: string,
    request: Request,
    scopeKey: string
  ): Promise<Response> {
    const rule = getRecommendationRule(ruleId, this.env);
    if (!rule) {
      return this.error("INVALID_RULE", `Unknown recommendation rule: ${ruleId}`, 404);
    }

    const body = await readJsonBody<NextRecommendationRequest>(request);
    const timezone = body.timezone || getDefaultTimezone(this.env);
    const locale = body.locale || getDefaultLocale(this.env) || rule.locale;
    const now = new Date();
    const dateKey = getDateKey(now, timezone);

    const existingCursor = await this.getCursor(ruleId, dateKey);
    if (existingCursor) {
      const batch = await this.getBatch(existingCursor.batchId);
      if (batch && existingCursor.nextIndex >= 1 && existingCursor.nextIndex <= batch.total) {
        const item = batch.items[existingCursor.nextIndex - 1];
        await this.putCursor(ruleId, dateKey, {
          batchId: batch.batchId,
          nextIndex: existingCursor.nextIndex + 1,
          updatedAt: now.toISOString(),
        });

        return this.json({
          ruleId,
          scopeKey,
          dateKey,
          batchId: batch.batchId,
          index: existingCursor.nextIndex,
          total: batch.total,
          isNewBatch: false,
          freshness: batch.freshness,
          recommendation: item,
        });
      }
    }

    const profile = await this.getProfile(scopeKey);
    const provider = createNewsProvider(this.env, rule.provider);
    const searchPlans = await buildSearchPlans(this.env, profile, rule, now, locale);
    const searchErrors: string[] = [];
    const searchResults = await Promise.all(
      searchPlans.map(async (plan) => {
        try {
          return await provider.search(plan);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          searchErrors.push(message);
          console.error("News provider search failed:", {
            plan,
            message,
          });
          return [];
        }
      })
    );

    const candidates = dedupeCandidates(searchResults.flat()).slice(0, rule.candidateTarget);
    if (!candidates.length) {
      return this.error(
        "UPSTREAM_FETCH_FAILED",
        searchErrors[0]
          ? `Failed to fetch recommendation candidates for the current rule. First upstream error: ${searchErrors[0]}`
          : "Failed to fetch recommendation candidates for the current rule.",
        502
      );
    }

    const items = await rankCandidates(this.env, candidates, profile, rule, locale);
    if (!items.length) {
      return this.error("NO_RECOMMENDATION_AVAILABLE", "No recommendation could be generated.", 502);
    }

    const batch: StoredRecommendationBatch = {
      batchId: `${ruleId}:${dateKey}:${crypto.randomUUID()}`,
      ruleId,
      dateKey,
      createdAt: now.toISOString(),
      freshness: provider.freshness,
      total: items.length,
      items,
    };

    await this.putBatch(batch);
    await this.putCursor(ruleId, dateKey, {
      batchId: batch.batchId,
      nextIndex: 2,
      updatedAt: now.toISOString(),
    });

    return this.json({
      ruleId,
      scopeKey,
      dateKey,
      batchId: batch.batchId,
      index: 1,
      total: batch.total,
      isNewBatch: true,
      freshness: batch.freshness,
      recommendation: batch.items[0],
    });
  }

  private async getProfile(scopeKey: string): Promise<PreferenceProfile> {
    const stored = await this.state.storage.get<PreferenceProfile>(PROFILE_KEY);
    return stored ?? createDefaultPreferenceProfile(scopeKey);
  }

  private async putProfile(profile: PreferenceProfile): Promise<void> {
    await this.state.storage.put(PROFILE_KEY, profile);
  }

  private async getCursor(ruleId: string, dateKey: string): Promise<RecommendationCursor | null> {
    return (await this.state.storage.get<RecommendationCursor>(cursorKey(ruleId, dateKey))) ?? null;
  }

  private async putCursor(ruleId: string, dateKey: string, cursor: RecommendationCursor): Promise<void> {
    await this.state.storage.put(cursorKey(ruleId, dateKey), cursor);
  }

  private async getBatch(batchId: string): Promise<StoredRecommendationBatch | null> {
    return (await this.state.storage.get<StoredRecommendationBatch>(batchKey(batchId))) ?? null;
  }

  private async putBatch(batch: StoredRecommendationBatch): Promise<void> {
    await this.state.storage.put(batchKey(batch.batchId), batch);
  }

  private json(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload, null, 2), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    });
  }

  private error(code: string, message: string, status: number): Response {
    return this.json(
      {
        error: {
          code,
          message,
        },
      },
      status
    );
  }
}

function batchKey(batchId: string): string {
  return `batch:${batchId}`;
}

function cursorKey(ruleId: string, dateKey: string): string {
  return `cursor:${ruleId}:${dateKey}`;
}

async function readJsonBody<T>(request: Request): Promise<T> {
  const text = await request.text();
  if (!text.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

function getDateKey(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }
}
