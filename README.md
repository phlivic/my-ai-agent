# Edge Intelligence Agent (Cloudflare Fast-Track Submission)

This is a stateful, realtime AI application built entirely on the Cloudflare Stack. It demonstrates the ability to coordinate LLMs with persistent edge state.

### 🚀 Assignment Requirements Met:
1.  **LLM**: Utilizes `Llama 3.3-70b` via **Workers AI** for high-reasoning capabilities.
2.  **Workflow / Coordination**: Built using the **Cloudflare Agents SDK** to orchestrate interactions and state updates.
3.  **User Input**: Implemented a **Realtime WebSocket interface** via **Cloudflare Pages**, ensuring sub-100ms interaction latency.
4.  **Memory / State**: Leverages **Durable Objects** to provide a "Long-term Memory." The agent remembers user names and interaction history even after page reloads or worker restarts.

### 🛠️ Tech Stack
- **Compute**: Cloudflare Workers
- **State**: Durable Objects (via Agents SDK)
- **AI**: Workers AI (Llama 3.3)
- **Frontend**: React + Vite on Cloudflare Pages
- **Communication**: WebSockets (Realtime)

### 📦 Deployment
1. **Backend**: `cd backend && npx wrangler deploy`
2. **Frontend**: `cd frontend && npm run build && npx wrangler pages deploy ./dist`

GPT-5.3-Codex Used.