# Edge Intelligence Agent (Cloudflare Agents + Workers AI)

This monorepo contains:
- `backend`: a Cloudflare Worker Agent with Durable Object state and Workers AI
- `frontend`: a React + Vite chat UI that talks to the backend over WebSocket

## Prerequisites

- Node.js 20+ and npm 10+
- A Cloudflare account with Workers and Workers AI access
- Wrangler CLI available through `npx wrangler` (installed from project dependencies)

## 1. Clone and Install

```bash
git clone <your-repo-url>
cd my-ai-agent
npm run install:all
```

This installs dependencies in both `backend` and `frontend`.

If you prefer manual install:

```bash
cd backend && npm install
cd ../frontend && npm install
```

## 2. Authenticate Cloudflare

Run once on a new machine:

```bash
cd backend
npx wrangler login
```

## 3. Run Locally (Recommended First)

Open two terminals.

Terminal A (backend):

```bash
cd backend
npm run dev
```

Terminal B (frontend):

```bash
cd frontend
npm run dev
```

Then open `http://localhost:5173`.

Notes:
- The frontend defaults to `ws://localhost:8787/agents/my-agent/default` for local development.
- This works with the current backend config in `backend/wrangler.toml`.
- For "ideas" Function, see instructions in `backend/.dev.vars.example`. Basically needs to copy the file, rename it and put your token from following website, then it will work!

## 4. Deploy Backend

```bash
cd backend
npm run deploy
```

After deploy, copy the Worker URL from the output, for example:
- `https://edge-ai-backend.<your-subdomain>.workers.dev`

Your chat WebSocket URL will be:
- `wss://edge-ai-backend.<your-subdomain>.workers.dev/agents/my-agent/default`

## 5. Configure Frontend for Production

Create `frontend/.env.production` from `frontend/.env.example` and set:

```dotenv
VITE_AGENT_WS_URL=wss://edge-ai-backend.<your-subdomain>.workers.dev/agents/my-agent/default
```

Then build:

```bash
cd frontend
npm run build
```

## 6. Deploy Frontend to Cloudflare Pages

If this is your first deploy, create a Pages project (or create it in the dashboard):

```bash
npx wrangler pages project create <your-pages-project-name>
```

Deploy the build output:

```bash
cd frontend
npx wrangler pages deploy ./dist --project-name <your-pages-project-name>
```

## Common Issues

- `Could not resolve "@cloudflare/agents"`:
  - You skipped backend install. Run `npm install` in `backend` (or run `npm run install:all` from repo root), then start again.
- `Missing VITE_AGENT_WS_URL` in production:
  - Set `VITE_AGENT_WS_URL` before `npm run build` (for example in `.env.production`).
- Frontend shows disconnected:
  - Confirm backend Worker is deployed and URL path includes `/agents/my-agent/default`.
- Wrangler authentication errors:
  - Re-run `npx wrangler login`.

## Tech Stack

- Backend: TypeScript, Cloudflare Agents SDK, Durable Objects, Workers AI
- Frontend: React + TypeScript + Vite
- Realtime transport: WebSocket
