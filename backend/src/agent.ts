import { Agent, type Connection, type WSMessage } from "@cloudflare/agents";

type ChatRole = "user" | "assistant";

interface ChatTurn {
  role: ChatRole;
  content: string;
}

export interface AgentState {
  userName: string;
  historyCount: number;
  preferences: string[];
  history: ChatTurn[];
}

interface Env {
  AI: {
    run: (
      model: string,
      input: { messages: Array<{ role: "system" | "user" | "assistant"; content: string }> }
    ) => Promise<{ response?: string } | { result?: { response?: string } } | string>;
  };
}

const INITIAL_STATE: AgentState = {
  userName: "Guest",
  historyCount: 0,
  preferences: [],
  history: [],
};

export class MyAgent extends Agent<Env, AgentState> {
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
    const updatedName = this.extractName(userText) ?? previousState.userName;
    const historyCount = previousState.historyCount + 1;

    const memoryHistory = previousState.history.slice(-12);
    const llmMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      {
        role: "system",
        content: `You are a helpful assistant with persistent memory.\nCurrent user name: ${updatedName}.\nInteraction count: ${historyCount}.\nBe concise and useful.`,
      },
      ...memoryHistory,
      { role: "user", content: userText },
    ];

    let assistantText = "Sorry, I could not generate a response right now.";
    try {
      const result = await this.env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages: llmMessages,
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
      preferences: previousState.preferences,
      history: [...memoryHistory, { role: "user", content: userText }, { role: "assistant", content: assistantText }].slice(-20),
    };

    this.setState(nextState);

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
