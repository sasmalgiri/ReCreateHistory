# ReCreateHistory

A local-first, private **knowledge OS**: point it at your documents, emails, and files, and it
**reconstructs history** — building a structured ledger of entities, dated events, timelines,
relationships, and distilled memory, then answering your questions with **cited, evidence-gated**
answers. The intelligence lives in the database, not the model. It's not chat-with-files: every
fact carries its sources, dates, and confidence, and conflicting evidence is surfaced, never
averaged away.

This repo contains two apps that share **one engine** (storage schema, capability routing, hybrid
retrieval, the evidence gate, and all 16 UI surfaces):

| | Folder | What it is |
| --- | --- | --- |
| 🖥️ **Desktop** | [`desktop/`](desktop/) | An installable Windows app (Electron + React + better-sqlite3). Fully offline/private via local Ollama. |
| 🌐 **Web** | [`web/`](web/) | A multi-user, hosted SaaS (Express + React). Sign up, upload documents, get an isolated private ledger. Ollama-if-reachable, else cloud. |

Both are the web-app port of the macOS-native Swift original,
[`sasmalgiri/kalsmritikosh`](https://github.com/sasmalgiri/kalsmritikosh).

## The engine (shared by both)

```
Ingest anything  →  clean · chunk · classify
        │
        ▼
Structured ledger (SQLite, 27 migrations, FTS5 + vectors)
  entities · events · timelines · relationships · memory · summaries
        │
        ▼
Hybrid retrieval   Memory → Timeline → Entity → FTS → Summary → Graph → Vector   (RRF-fused)
        │
        ▼
Master Brain   intent → route → experts → EvidenceVerifier (the evidence gate)
        │
        ▼
Cited answer + Quality Strip (confidence, evidence counts, freshness, conflicts, "why this answer?")
```

- **Capability discipline** — callers declare *what a call must achieve*; a CapabilityRegistry
  resolves it to a provider. Model names never leak into the domain layers.
- **Privacy is enforced, not promised** — a PrivacyGate keeps cloud providers out of resolution
  unless explicitly allowed; the desktop app is fully offline via Ollama.
- **AI = "both"** — local Ollama first (more private), cloud fallback (Anthropic/OpenAI) when configured.

## Quick start

**Desktop** (Windows):
```powershell
cd desktop
npm install
npm run dev          # launches the app
npm run package      # → a Windows installer (release/)
```

**Web** (local or hosted):
```powershell
cd web
npm install
npm run dev          # UI on :5173, API on :8787 → sign up → upload → ask
docker build -t recreatehistory-web .   # to deploy (see web/README.md)
```

For LLM answers + semantic search, run Ollama (`ollama pull qwen2.5:7b && ollama pull nomic-embed-text`)
or set a cloud key. Without either, ingestion + full-text search + heuristic answers still work.

## Status

A broad, working scaffold of the full architecture. Verified end-to-end (typecheck + build +
ingest→ledger→cited-answer smoke, plus a signup→upload→ask→isolation smoke on web). Marked
follow-on: image OCR / audio transcription loaders, HNSW ANN index, community/topic detection,
the full narrative composer, and deeper per-expert LLM prompting. See each app's README for details.

## License

MIT
