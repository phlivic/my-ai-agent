import type { AppEnv } from "../env";
import type { PreferenceInferenceResult, PreferenceProfile } from "./types";

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export async function inferPreferenceUpdate(
  env: AppEnv,
  userMessage: string,
  profile: PreferenceProfile
): Promise<PreferenceInferenceResult | null> {
  try {
    const result = await env.AI.run(MODEL, {
      messages: [
        {
          role: "system",
          content:
            "You extract user preference updates from a single user chat message. Return JSON only. Use the shape {\"displayName\":\"\",\"interestsToAdd\":[],\"interestsToRemove\":[],\"keywordsToAdd\":[],\"keywordsToRemove\":[],\"regionsToAdd\":[],\"regionsToRemove\":[],\"sourcesToAdd\":[],\"sourcesToRemove\":[],\"avoidToAdd\":[],\"avoidToRemove\":[],\"reason\":\"\",\"confidence\":0}. Only use evidence from the user's message. Be willing to remove outdated preferences when the message explicitly contradicts them. Do not infer or change reply language preferences here; language is controlled manually in settings.",
        },
        {
          role: "user",
          content: [
            `Current display name: ${profile.displayName}`,
            `Current interests: ${profile.interests.join(", ") || "(none)"}`,
            `Current keywords: ${profile.keywords.join(", ") || "(none)"}`,
            `Current regions: ${profile.regions.join(", ") || "(none)"}`,
            `Current sources: ${profile.sources.join(", ") || "(none)"}`,
            `Current avoid: ${profile.avoid.join(", ") || "(none)"}`,
            `User message: ${userMessage}`,
            "Return only fields supported by the schema. Use empty arrays for no changes.",
          ].join("\n"),
        },
      ],
    });

    const parsed = parseJson<PreferenceInferenceResult>(extractText(result));
    if (!parsed) {
      return null;
    }

    return {
      displayName: typeof parsed.displayName === "string" ? parsed.displayName.trim() : undefined,
      interestsToAdd: sanitizeStringArray(parsed.interestsToAdd),
      interestsToRemove: sanitizeStringArray(parsed.interestsToRemove),
      keywordsToAdd: sanitizeStringArray(parsed.keywordsToAdd),
      keywordsToRemove: sanitizeStringArray(parsed.keywordsToRemove),
      regionsToAdd: sanitizeStringArray(parsed.regionsToAdd),
      regionsToRemove: sanitizeStringArray(parsed.regionsToRemove),
      sourcesToAdd: sanitizeStringArray(parsed.sourcesToAdd),
      sourcesToRemove: sanitizeStringArray(parsed.sourcesToRemove),
      avoidToAdd: sanitizeStringArray(parsed.avoidToAdd),
      avoidToRemove: sanitizeStringArray(parsed.avoidToRemove),
      reason: typeof parsed.reason === "string" ? parsed.reason.trim() : undefined,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    };
  } catch (error) {
    console.error("Failed to infer preference update:", error);
    return null;
  }
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

function parseJson<T>(text: string): T | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  const jsonText = start !== -1 && end !== -1 ? candidate.slice(start, end + 1) : candidate;

  try {
    return JSON.parse(jsonText) as T;
  } catch {
    return null;
  }
}

function sanitizeStringArray(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}
