import type { AppEnv } from "../env";
import { DEFAULT_SCOPE_KEY } from "../recommendations/rules";
import type { PreferenceInferenceResult, PreferenceProfile, PreferenceProfilePatch } from "./types";

export async function getPreferenceProfile(
  env: AppEnv,
  scopeKey = DEFAULT_SCOPE_KEY
): Promise<PreferenceProfile> {
  const response = await callPreferenceStore<{ profile: PreferenceProfile }>(
    env,
    scopeKey,
    "/api/profile/preferences",
    { method: "GET" }
  );
  return response.profile;
}

export async function patchPreferenceProfile(
  env: AppEnv,
  patch: PreferenceProfilePatch,
  scopeKey = DEFAULT_SCOPE_KEY
): Promise<PreferenceProfile> {
  const response = await callPreferenceStore<{ profile: PreferenceProfile }>(
    env,
    scopeKey,
    "/api/profile/preferences",
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    }
  );
  return response.profile;
}

export async function setPreferenceLock(
  env: AppEnv,
  locked: boolean,
  scopeKey = DEFAULT_SCOPE_KEY
): Promise<PreferenceProfile> {
  const response = await callPreferenceStore<{ profile: PreferenceProfile }>(
    env,
    scopeKey,
    "/api/profile/preferences/lock",
    {
      method: "PATCH",
      body: JSON.stringify({ locked }),
    }
  );
  return response.profile;
}

export async function applyPreferenceInference(
  env: AppEnv,
  inference: PreferenceInferenceResult,
  scopeKey = DEFAULT_SCOPE_KEY
): Promise<PreferenceProfile> {
  const response = await callPreferenceStore<{ profile: PreferenceProfile }>(
    env,
    scopeKey,
    "/api/profile/preferences/infer",
    {
      method: "PATCH",
      body: JSON.stringify(inference),
    }
  );
  return response.profile;
}

async function callPreferenceStore<T>(
  env: AppEnv,
  scopeKey: string,
  path: string,
  init: RequestInit
): Promise<T> {
  const id = env.RECOMMENDATION_STORE.idFromName(scopeKey);
  const stub = env.RECOMMENDATION_STORE.get(id);
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("x-recommendation-scope", scopeKey);

  const response = await stub.fetch(
    new Request(`https://preferences.internal${path}`, {
      method: init.method,
      headers,
      body: init.body,
    })
  );

  const payload = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(payload.error?.message || `Preference store request failed: ${response.status}`);
  }

  return payload;
}
