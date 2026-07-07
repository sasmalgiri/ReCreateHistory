# ReCreateHistory — Online (multi-user SaaS)

The hosted, multi-user web version of [`kalsmritikosh`](https://github.com/sasmalgiri/kalsmritikosh) —
a knowledge OS where you **sign up, upload your documents, and get evidence-gated cited answers**.
Each account gets its own **isolated SQLite ledger**; the intelligence lives in that structured
database (entities, dated events, timelines, relationships, distilled memory), not in the model.

It reuses the **exact same engine** as the desktop app (`desktop/`) — storage schema (all
27 migrations), capability routing, hybrid retrieval, the evidence gate, and all 16 UI screens — and
adds accounts, per-user data isolation, an HTTP + SSE transport, and browser upload.

## How it works

```
Browser (React, same 16 screens)
  │  cookie session (JWT, httpOnly)
  ▼
Express server
  ├─ POST /api/auth/{signup,login,logout,me}   accounts (bcrypt)
  ├─ POST /api/invoke   {path,args}            the window.km RPC surface
  ├─ GET  /api/events   (SSE)                  streaming answers + ingest ticks
  └─ POST /api/upload   (multipart)            files → ingest
       │
       ▼  per user, lazily created + cached
  UserApp  = Repos(user ledger) + CapabilityRegistry + HybridRetriever + MasterBrain + IngestCoordinator
       │
  data/users/<userId>/ledger.sqlite3   ← each user's isolated knowledge base
  data/system.sqlite3                  ← the accounts table
```

**AI engine — "both":** the CapabilityRegistry uses a reachable **Ollama** first (more private), and
falls back to a **cloud** model (Anthropic/OpenAI) via a server-side key. Answers are gated by
evidence — with no supporting sources in the ledger, the app refuses rather than hallucinate.

## Run locally

```powershell
npm install
# two dev servers: Vite (UI, :5173) + Express API (:8787), UI proxies /api → API
npm run dev
# open http://localhost:5173  →  sign up  →  Upload files  →  Ask
```

For LLM synthesis + semantic search, either run Ollama locally
(`ollama pull qwen2.5:7b && ollama pull nomic-embed-text`) or set a cloud key (see below).
Without either, ingestion + full-text search + heuristic answers still work.

## Configure

Copy `.env.example` → `.env`. Key vars:

| Var | Purpose |
| --- | --- |
| `JWT_SECRET` | **required in prod** — signs session cookies |
| `DATA_DIR` | where per-user ledgers + uploads live (use a persistent disk in prod) |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | cloud LLM fallback |
| `CLOUD_MODEL` | e.g. `claude-sonnet-5` or `gpt-4o-mini` |
| `OLLAMA_URL` / `OLLAMA_MODEL` / `OLLAMA_EMBED` | optional local engine |

## Deploy online

Any host that runs a Node process with a **persistent disk** (for the SQLite ledgers):

```bash
docker build -t web .
docker run -p 8787:8787 -e JWT_SECRET=$(openssl rand -hex 48) \
  -e ANTHROPIC_API_KEY=sk-ant-... -v km_data:/data web
```

**Render / Railway / Fly.io:** point at this repo, set the env vars above, and attach a
persistent volume mounted at `/data` (`DATA_DIR=/data`). Build command `npm run build`,
start command `npm start`.

> Scaling note: this starter keeps one SQLite ledger per user on the server's disk and caches
> active `UserApp`s in memory (idle ones are evicted). That scales vertically to a solid user
> count on one box. To scale horizontally later, swap the per-user `Repos` driver to a hosted
> libSQL/Turso database per user — the schema is already SQLite-compatible.

## Verify

```powershell
npm run typecheck     # server + web
npm run smoke         # ingest a fixture → build ledger → run a real Ask (per-user pipeline)
```

## Going public — hardening (built in)

- **Rate limiting**: login/signup/reset are IP-limited; `/api/invoke` and uploads are per-user limited. Brute force returns 429.
- **Quotas**: per-user storage (`STORAGE_QUOTA_MB`, default 500) and daily LLM-answer cap (`ASK_DAILY_LIMIT`, default 200) — a hostile user can't fill your disk or burn your API credits.
- **Email verification + password reset**: set `RESEND_API_KEY` (+ `EMAIL_FROM`, `APP_URL`, optionally `REQUIRE_EMAIL_VERIFICATION=true`). Without a provider, reset returns a clear 501 and verification is not required (self-host mode).
- **Legal**: `/terms` and `/privacy` are served and linked from the login screen — review the wording before launch (template, not legal advice).
- **Deployment**: strong `JWT_SECRET` (enforced in prod), HTTPS via your host, persistent volume at `DATA_DIR`.
