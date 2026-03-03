/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AGENT_WS_URL?: string;
  readonly VITE_RECOMMENDATION_API_URL?: string;
  readonly VITE_PREFERENCE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
