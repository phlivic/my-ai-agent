import { Agent, type Connection, type WSMessage } from "@cloudflare/agents";
import type { AppEnv } from "./env";
import { applyPreferenceInference, getPreferenceProfile } from "./preferences/client";
import { inferPreferenceUpdate } from "./preferences/inference";

type ChatRole = "user" | "assistant";

interface ChatTurn {
  role: ChatRole;
  content: string;
}

export interface AgentState {
  userName: string;
  historyCount: number;
  history: ChatTurn[];
}

const INITIAL_STATE: AgentState = {
  userName: "Guest",
  historyCount: 0,
  history: [],
};

const CONTEXT_HISTORY_LIMIT = 24;
const STORED_HISTORY_LIMIT = 40;
const CHAT_MAX_TOKENS = 768;

export class MyAgent extends Agent<AppEnv, AgentState> {
  onStart(): void {
    if (!this.state) {
      this.setState(INITIAL_STATE);
    }
  }

  onConnect(connection: Connection): void {
    const state = this.getState();
    connection.send(
      JSON.stringify({
        type: "system",
        text: `Connected. Welcome back ${state.userName}.`,
      })
    );
  }

  async onMessage(connection: Connection, message: WSMessage): Promise<void> {
    const userText = this.extractUserText(message);
    if (!userText) {
      return;
    }

    const previousState = this.getState();
    const profile = await getPreferenceProfile(this.env).catch(() => null);
    const profileName = profile?.displayName?.trim() || previousState.userName;
    const updatedName = this.extractName(userText) ?? profileName;
    const historyCount = previousState.historyCount + 1;
    const replyLanguageInstruction = getReplyLanguageInstruction(userText, profile?.languages);
    const now = new Date();
    const runtimeDateInstruction = getRuntimeDateInstruction(now);

    const memoryHistory = previousState.history.slice(-CONTEXT_HISTORY_LIMIT);
    const llmMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      {
        role: "system",
        content: [
          "You are a helpful assistant with persistent memory.",
          `Current user name: ${updatedName}.`,
          `Interaction count: ${historyCount}.`,
          runtimeDateInstruction,
          profile?.interests?.length ? `User interests: ${profile.interests.join(", ")}.` : "",
          profile?.keywords?.length ? `Useful search keywords: ${profile.keywords.join(", ")}.` : "",
          profile?.avoid?.length ? `Avoid over-indexing on: ${profile.avoid.join(", ")}.` : "",
          replyLanguageInstruction,
          "Be concise and useful.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
      ...memoryHistory,
      {
        role: "system",
        content: `${replyLanguageInstruction} This language rule has higher priority than the language used in the user's message. Follow the configured reply language unless the user explicitly asks to switch languages in this turn.`,
      },
      { role: "user", content: userText },
    ];

    let assistantText = "Sorry, I could not generate a response right now.";
    try {
      const result = await this.env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages: llmMessages,
        max_tokens: CHAT_MAX_TOKENS,
      });
      const text =
        typeof result === "string"
          ? result
          : typeof result?.response === "string"
            ? result.response
            : typeof result?.result?.response === "string"
              ? result.result.response
              : "";
      if (text.trim()) {
        assistantText = text;
      }
    } catch (error) {
      console.error("Workers AI request failed:", error);
    }

    const nextState: AgentState = {
      userName: updatedName,
      historyCount,
      history: [...memoryHistory, { role: "user", content: userText }, { role: "assistant", content: assistantText }].slice(
        -STORED_HISTORY_LIMIT
      ),
    };

    this.setState(nextState);

    if (profile && !profile.locked) {
      try {
        const inferred = await inferPreferenceUpdate(this.env, userText, profile);
        if (inferred) {
          if (!inferred.displayName) {
            const extractedName = this.extractName(userText);
            if (extractedName) {
              inferred.displayName = extractedName;
            }
          }
          await applyPreferenceInference(this.env, inferred);
        }
      } catch (error) {
        console.error("Preference inference update failed:", error);
      }
    }

    connection.send(
      JSON.stringify({
        type: "chat",
        text: assistantText,
        memory: {
          userName: nextState.userName,
          historyCount: nextState.historyCount,
        },
      })
    );
  }

  onRequest(request: Request): Response {
    if (request.method === "GET" && new URL(request.url).pathname.endsWith("/state")) {
      return Response.json(this.getState());
    }
    return new Response("Not Found", { status: 404 });
  }

  private getState(): AgentState {
    return this.state ?? INITIAL_STATE;
  }

  private extractUserText(message: WSMessage): string | null {
    if (typeof message !== "string") {
      return null;
    }

    try {
      const data = JSON.parse(message) as { type?: string; text?: unknown };
      if (data.type === "chat" && typeof data.text === "string" && data.text.trim()) {
        return data.text.trim();
      }
    } catch {
      if (message.trim()) {
        return message.trim();
      }
    }

    return null;
  }

  private extractName(text: string): string | null {
    const en = text.match(/\bmy name is\s+(.+)$/i);
    if (en?.[1]) {
      return en[1].trim();
    }

    const zh = text.match(/(?:\u6211\u53EB|\u6211\u7684\u540D\u5B57\u662F)\s*([^\s\uff0c\u3002,.!?]+)/);
    if (zh?.[1]) {
      return zh[1].trim();
    }

    return null;
  }
}

function getReplyLanguageInstruction(userText: string, languages: string[] | undefined): string {
  const explicitOverride = detectExplicitLanguageOverride(userText);
  if (explicitOverride === "zh") {
    return "Reply in Simplified Chinese for this message. Do not answer in English.";
  }
  if (explicitOverride === "en") {
    return "Reply in English for this message. Do not answer in Chinese.";
  }

  const primaryLanguage = languages?.[0]?.trim().toLowerCase() || "english";
  if (primaryLanguage.startsWith("chinese") || primaryLanguage.startsWith("zh")) {
    return "Reply in Simplified Chinese only. Do not switch to another language just because the user's message is written in another language. Only switch if the user explicitly asks for another language in this message.";
  }
  return "Reply in English only. Do not switch to another language just because the user's message is written in another language. Only switch if the user explicitly asks for another language in this message.";
}

function detectExplicitLanguageOverride(text: string): "zh" | "en" | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (
    /(?:reply|respond|answer)\s+(?:in\s+)?english/.test(normalized) ||
    /please use english/.test(normalized) ||
    /用英文/.test(text)
  ) {
    return "en";
  }

  if (
    /(?:reply|respond|answer)\s+(?:in\s+)?chinese/.test(normalized) ||
    /please use chinese/.test(normalized) ||
    /用中文/.test(text) ||
    /请用中文/.test(text)
  ) {
    return "zh";
  }

  return null;
}

function getRuntimeDateInstruction(now: Date): string {
  return `Current date and time: ${now.toISOString()}. Use this runtime date when the user asks about today, yesterday, tomorrow, or the day of the week.`;
}
