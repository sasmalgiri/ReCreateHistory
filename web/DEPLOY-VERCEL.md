# Deploy ReCreateHistory to Vercel + Turso (free tiers)

The web app runs on Vercel serverless functions with **one Turso (hosted SQLite)
database per user** — persistent, isolated, and on free tiers for both services.

## One-time setup (~10 minutes)

### 1. Turso (the databases)

```bash
# install the CLI and sign up (free)
irm get.tur.so/install.ps1 | iex        # Windows PowerShell
turso auth signup

# a group holds all per-user databases in one region
turso group create default

# token the APP uses to read/write the databases in the group
turso group tokens create default        # → TURSO_GROUP_TOKEN

# token the APP uses to CREATE a database when a user signs up
turso auth api-tokens mint recreatehistory   # → TURSO_API_TOKEN

# your organization slug (shown by:)
turso org list                           # → TURSO_ORG
```

### 2. Vercel (the app)

```bash
npm i -g vercel
cd web
vercel login
vercel link        # create a new project when prompted

# secrets (paste values from step 1)
vercel env add TURSO_API_TOKEN production
vercel env add TURSO_ORG production
vercel env add TURSO_GROUP production        # value: default
vercel env add TURSO_GROUP_TOKEN production
vercel env add JWT_SECRET production         # long random string
# optional but recommended:
vercel env add ANTHROPIC_API_KEY production  # or OPENAI_API_KEY (AI answers)
vercel env add RESEND_API_KEY production     # email verify + password reset
vercel env add EMAIL_FROM production
vercel env add APP_URL production            # https://<project>.vercel.app
vercel env add REQUIRE_EMAIL_VERIFICATION production   # true

vercel --prod
```

Done — the printed URL is your live app.

## What's different on Vercel (vs self-host)

| Concern | Self-host | Vercel |
| --- | --- | --- |
| User data | SQLite files on disk | one Turso DB per user (created at signup) |
| Uploads | streamed to disk, ingested async | staged in `/tmp`, **ingested within the upload request** (keep files ≤ 4 MB — platform body limit) |
| Answer streaming | SSE stage ticks | single request/response (same final answer) |
| AI | local Ollama or cloud key | cloud key (no Ollama on serverless) |
| Rate limits | per process | per warm instance (still effective per burst) |

## Limits to know

- Vercel Hobby request body ≈ 4.5 MB → per-file upload cap on Vercel. For bigger
  archives, self-host or use the desktop app.
- Function time limit 60 s → very large single files may need splitting.
- Turso free tier (as of writing): 500 databases, 9 GB total storage — hundreds
  of users on a free stack; upgrade Turso when you outgrow it.

## Local development against the same stack

No Turso needed locally — the same async client runs on plain files:

```bash
npm run dev     # data in ./data/**.db (file: URLs)
```
