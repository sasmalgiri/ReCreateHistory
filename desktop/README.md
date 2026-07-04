# ReCreateHistory — Desktop (Windows)

A local-first, private **knowledge OS** for Windows — the web-app/Electron port of the
macOS-native [`kalsmritikosh`](https://github.com/sasmalgiri/kalsmritikosh) ("Atlas chronica
memora"). Ingest anything (PDFs, docs, emails, spreadsheets, web pages), and it builds a
**structured ledger** — canonical entities, dated events, timelines, relationships, distilled
memory, summaries, chunks, FTS, and vectors — then answers questions through experts behind an
**evidence gate**, with every claim tied to its sources.

This is **not** a chat-with-files RAG app. The intelligence lives in the database, not the model.

## Why it stays private on Windows

The macOS app runs on-device (MLX / Apple FoundationModels). The Windows port preserves that
promise with **[Ollama](https://ollama.com)** as the default engine — everything runs locally and
offline. A cloud provider (Anthropic / OpenAI) is **optional** and only ever usable when you
explicitly open the **Privacy Gate** in Settings.

## Stack

| Layer | Tech |
| --- | --- |
| Shell | Electron 33 (Windows `.exe`/`.msi`) |
| UI | React 18 + TypeScript + Tailwind CSS |
| Ledger | better-sqlite3 (SQLite + FTS5), 27 versioned migrations |
| Vectors | int8-quantized store, brute-force cosine (HNSW is future work) |
| AI | Ollama (local, default) + optional Cloud, via a CapabilityRegistry |

## Architecture (mirrors the Swift app)

```
src/
  shared/                 domain models + AI types + the IPC contract
  main/                   Electron main process (the backend)
    storage/              Ledger (better-sqlite3), migrations, repositories, vector store
    routing/              CapabilityRegistry, PrivacyGate, providers (Ollama, Cloud), Router, IntentDetector
    ingestion/            loaders, cleaner, chunker, classifier, IngestCoordinator
    knowledge/            entity/event/date extractors, graph, timeline, summarizer, memory distiller
    retrieval/            HybridRetriever (Memory → Timeline → Entity → FTS → Summary → Graph → Vector, RRF-fused)
    brain/                MasterBrain, experts, EvidenceVerifier (the evidence gate)
    app/                  AppState boot + preferences/secrets
    ipc/                  the IPC handlers (backend half of window.km)
  preload/                the contextIsolation bridge (window.km)
  renderer/               React app: shell + 16 screens (Ask, Search, Timeline, …, Settings)
```

The **retrieval priority order** (structure first, similarity last), the **capability discipline**
(callers declare a `CapabilitySpec`, never a model), the **evidence gate** (no sources → no
answer; conflicts surfaced, not averaged), and the **quality strip** are all ported faithfully.

## Prerequisites

1. **Node.js 20+** and npm.
2. **[Ollama](https://ollama.com/download/windows)** installed and running, with at least a
   reasoning model and an embedding model:
   ```powershell
   ollama pull qwen2.5:7b
   ollama pull nomic-embed-text
   ```
   (Configure the exact tags in **Settings**. Without a model, the app still ingests, searches
   via FTS, and answers heuristically — it just won't do LLM synthesis or semantic search.)

## Develop

```powershell
npm install          # postinstall rebuilds better-sqlite3 for Electron's ABI
npm run dev          # launches the app with hot reload
```

If SQLite fails to load with a `NODE_MODULE_VERSION` error, run `npm run rebuild`.

## Build a Windows installer

```powershell
npm run package      # electron-builder → dist/*.exe (NSIS installer)
npm run pack:dir     # unpacked build (no installer)
```

## Type-check

```powershell
npm run typecheck    # tsc for both the Node (main) and web (renderer) projects
```

## Data location

The ledger and preferences live under `%APPDATA%/desktop/`
(`ledger.sqlite3`, `preferences.json`, `secrets.json`, `appmeta.json`). Nothing is ever sent
off-device unless you enable cloud routing.

## Status

Broad scaffold of the full architecture with a working end-to-end path (ingest → ledger →
retrieve → cited answer). Faithfully ported: storage schema (all 27 migrations), capability
routing, hybrid retrieval, the evidence gate, and all 16 UI surfaces. Clearly-marked follow-on
work: OCR (images) and ASR (audio/video) loaders, HNSW ANN index, community/topic detection,
narrative composer, and per-expert LLM prompting depth.
