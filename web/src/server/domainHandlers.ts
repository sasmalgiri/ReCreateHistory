//
// domainHandlers.ts — the same window.km dispatch surface as the desktop app,
// but transport-agnostic and scoped to ONE user's UserApp. The Express layer
// routes an authenticated /api/invoke {path,args} here. File picking happens in
// the browser (upload), so pickFiles/pickFolder/openPath are client-side no-ops.
//

import type { UserApp } from './userApp'
import { detectSourceType } from './ingestion/sourceType'
import { loadFile } from './ingestion/loaders'
import { extractiveSummary } from './knowledge/summarizer'
import { sourceCategory } from '../shared/models'
import type { UUID, Assertion } from '../shared/models'
import { newID } from './core/ids'
import { RuleIntentDetector } from './routing/intentDetector'
import { RETRIEVAL_PRIORITY } from '../shared/ai'
import { config } from './config'
import { log } from './core/logger'
import type {
  AppStatus, IngestActivity, SearchHit, EntityDossier, LiveSample, TimelineQuery, Preferences
} from '../shared/ipc'

export type PushFn = (topic: string, payload: unknown) => void
export type HandlerMap = Record<string, (...args: any[]) => Promise<unknown>>

export function createHandlers(app: UserApp, push: PushFn): HandlerMap {
  // Stream ingest activity to this user's live connections.
  app.coordinator.onActivity((s) => push('ingest', { activeCount: s.activeCount, lastFile: s.lastFile }))

  return {
    // ── app ──
    'app.status': async (): Promise<AppStatus> => ({
      phase: 'ready', databasePath: 'per-user ledger', schemaVersion: app.repos.ledger.schemaVersion,
      hasRoots: app.roots().length > 0, onboardingShown: app.onboardingShown
    }),
    'app.inventory': async () => app.inventory(),
    'app.ingestActivity': async (): Promise<IngestActivity> => ({
      activeCount: app.coordinator.state.activeCount, lastFile: app.coordinator.state.lastFile,
      totalFiles: app.repos.files.count(), totalObjects: app.repos.objects.count()
    }),
    'app.markOnboardingShown': async () => { app.markOnboardingShown() },
    'app.openPath': async () => { /* no-op on web — server files aren't the user's local files */ },

    // ── ingest (files arrive via /api/upload; addPaths ingests them) ──
    'ingest.pickFiles': async () => [],   // handled in the browser (upload)
    'ingest.pickFolder': async () => null, // handled in the browser (upload)
    'ingest.addPaths': async (paths: string[]) => {
      ;(async () => {
        const res = await app.coordinator.ingestPaths(paths)
        log.ingestion(`ingest batch done for ${app.userId.slice(0, 8)}: +${res.ingested} (${res.skipped} skipped)`)
        await app.postIngest()
        push('ingest', { activeCount: 0, lastFile: app.coordinator.state.lastFile })
      })().catch((e) => log.ingestion.error('ingest batch failed', e))
      return { queued: paths.length }
    },
    'ingest.listFiles': async (limit?: number) => app.repos.files.list(limit ?? 500),
    'ingest.reingest': async (fileID: UUID) => {
      const f = app.repos.files.byID(fileID)
      if (f) { app.repos.files.remove(fileID); await app.coordinator.ingestPaths([f.url]) }
    },
    'ingest.remove': async (fileID: UUID) => { app.repos.files.remove(fileID) },
    'ingest.roots': async () => app.roots(),
    'ingest.addRoot': async (p: string) => { app.addRoot(p) },
    'ingest.removeRoot': async (p: string) => { app.removeRoot(p) },

    // ── ask ──
    'ask.ask': async (question: string) => app.brain.ask(question),
    'ask.start': async (question: string) => {
      const id = newID()
      ;(async () => {
        try { await app.brain.askStream(question, (u) => push('ask', { id, ...u })) }
        catch (err) { push('ask', { id, kind: 'error', message: String(err) }) }
      })()
      return { id }
    },
    'ask.conversations': async () => app.repos.conversations.list(),
    'ask.detectIntent': async (question: string) => new RuleIntentDetector().detect(question),
    'ask.retrieveOnly': async (question: string) => {
      const intent = new RuleIntentDetector().detect(question)
      return app.retriever.retrieve(intent, RETRIEVAL_PRIORITY)
    },

    // ── search ──
    'search.query': async (text: string, limit?: number): Promise<SearchHit[]> => {
      const ranks = app.repos.chunks.ftsSearch(text, limit ?? 30)
      const hits: SearchHit[] = []
      for (const r of ranks) {
        const c = app.repos.chunks.byID(r.chunkID); if (!c) continue
        const ko = app.repos.objects.byID(c.objectID); if (!ko) continue
        hits.push({ objectID: ko.id, chunkID: c.id, sourceFile: ko.sourceFile, sourceCategory: sourceCategory(ko.sourceType), snippet: c.text.slice(0, 240), score: -r.rank, via: 'fts' })
      }
      return hits
    },
    'search.semantic': async (text: string, limit?: number): Promise<SearchHit[]> => {
      const qvec = await app.capabilities.embed(text)
      if (!qvec) return []
      const near = app.repos.vectors.nearest(qvec, limit ?? 30)
      const hits: SearchHit[] = []
      for (const n of near) {
        const c = app.repos.chunks.byID(n.chunkID); if (!c) continue
        const ko = app.repos.objects.byID(c.objectID); if (!ko) continue
        hits.push({ objectID: ko.id, chunkID: c.id, sourceFile: ko.sourceFile, sourceCategory: sourceCategory(ko.sourceType), snippet: c.text.slice(0, 240), score: n.score, via: 'vector' })
      }
      return hits
    },

    // ── timeline ──
    'timeline.events': async (q: TimelineQuery) => app.timeline.events(q),
    'timeline.eventDetail': async (id: UUID) => {
      const event = app.repos.events.byID(id)
      if (!event) return { event: null, entities: [], object: null }
      const entities = app.repos.events.entitiesFor(id).map((eid) => app.repos.entities.byID(eid)).filter(Boolean)
      return { event, entities, object: app.repos.objects.byID(event.sourceObjectID) }
    },
    'timeline.causalLinks': async (id: UUID) => app.repos.eventLinks.forEvent(id),

    // ── knowledge ──
    'knowledge.entities': async (kind?: string, limit?: number) => app.repos.entities.list(kind, limit),
    'knowledge.events': async (limit?: number) => app.repos.events.list(limit),
    'knowledge.memories': async () => app.repos.memory.list(),
    'knowledge.summaries': async (level?: string) => app.repos.summaries.list(level),
    'knowledge.objects': async (limit?: number) => app.repos.objects.list(limit),
    'knowledge.objectContent': async (id: UUID) => app.repos.objects.byID(id),

    // ── dossier ──
    'dossier.forEntity': async (id: UUID): Promise<EntityDossier | null> => {
      const entity = app.repos.entities.byID(id)
      if (!entity) return null
      const events = app.repos.events.forEntity(id, 100)
      const relationships = app.repos.relationships.forEntity(id, 60)
      const nb = app.graph.neighborhood(id, 1)
      const neighbors = nb.nodes.filter((n) => n.id !== id).map((n) => ({ entity: app.repos.entities.byID(n.id)!, weight: n.weight })).filter((x) => x.entity).slice(0, 20)
      const subjectKind = ['organization', 'vendor', 'client'].includes(entity.kind) ? 'organization' : entity.kind === 'person' ? 'person' : entity.kind === 'project' ? 'project' : 'topic'
      const memory = app.repos.memory.bySubject(subjectKind as any, entity.normalizedValue ?? entity.value.toLowerCase())
      const dates = events.map((e) => e.date)
      return {
        entity, aliases: app.repos.entities.aliases(id), mentionCount: app.repos.entities.mentionCount(id),
        events, relationships, neighbors, memory,
        firstSeen: dates.length ? Math.min(...dates) : null, lastSeen: dates.length ? Math.max(...dates) : null,
        sourceObjectIDs: [...new Set(events.map((e) => e.sourceObjectID))]
      }
    },
    'dossier.search': async (name: string) => app.repos.entities.search(name, 25),

    // ── graph ──
    'graph.neighborhood': async (entityID: UUID, hops?: number) => app.graph.neighborhood(entityID, hops ?? 1),
    'graph.topEntities': async (limit?: number) => app.graph.topEntities(limit ?? 40),

    // ── assertions ──
    'assertions.list': async (subjectID?: UUID) => app.repos.assertions.list(subjectID),
    'assertions.add': async (a: Omit<Assertion, 'id' | 'recordedAt' | 'retractedAt'>) => app.repos.assertions.add(a),
    'assertions.retract': async (id: UUID) => { app.repos.assertions.retract(id) },

    // ── notebook ──
    'notebook.list': async () => app.repos.investigations.list(),
    'notebook.get': async (id: UUID) => app.repos.investigations.get(id),
    'notebook.run': async (question: string) => {
      const { investigationID } = await app.brain.investigate(question)
      return app.repos.investigations.get(investigationID)
    },
    'notebook.remove': async (id: UUID) => { app.repos.investigations.remove(id) },

    // ── saved ──
    'saved.list': async () => app.repos.saved.list(),
    'saved.add': async (question: string, title?: string, notes?: string) => app.repos.saved.add(question, title, notes),
    'saved.remove': async (id: UUID) => { app.repos.saved.remove(id) },
    'saved.touch': async (id: UUID) => { app.repos.saved.touch(id) },

    // ── live ──
    'live.sample': async (): Promise<LiveSample> => {
      const inv = app.inventory()
      return {
        at: Date.now(), ingestActive: app.coordinator.state.activeCount,
        objects: inv.objects, chunks: inv.chunks, entities: inv.entities, events: inv.events, vectors: inv.vectors,
        pipeline: { files: inv.files, objects: inv.objects, chunks: inv.chunks, entities: inv.entities, events: inv.events },
        services: [
          { name: 'Ledger', healthy: true, detail: `schema v${app.repos.ledger.schemaVersion}` },
          { name: 'Ingest', healthy: true, detail: `${app.coordinator.state.activeCount} active` }
        ]
      }
    },

    // ── evidence ledger ──
    'ledger.blocks': async (objectID: UUID) => app.repos.blocks.byObject(objectID),
    'ledger.claims': async (objectID?: UUID, limit?: number) => app.repos.claims.list(objectID, limit ?? 300),
    'ledger.contradictions': async () => app.repos.contradictions.list(),
    'ledger.contradictionDetail': async (id: UUID) => {
      const contradiction = app.repos.contradictions.byID(id)
      if (!contradiction) return { contradiction: null, a: null, b: null }
      return {
        contradiction,
        a: contradiction.aKind === 'event' ? app.repos.events.byID(contradiction.aID) : null,
        b: contradiction.bKind === 'event' ? app.repos.events.byID(contradiction.bID) : null
      }
    },
    'ledger.missingProof': async () => {
      const { missingProof } = await import('./knowledge/factStatus')
      return missingProof(app.repos)
    },
    'ledger.factMatrix': async () => {
      const { factMatrix } = await import('./knowledge/factStatus')
      return factMatrix(app.repos)
    },
    'ledger.ingestionRuns': async (limit?: number) => app.repos.ingestionRuns.list(limit ?? 100),
    'ledger.eventsByStatus': async (status?: string, limit?: number) =>
      app.repos.events.byStatus(status as never, limit ?? 300),
    'ledger.reviewEvent': async (id: UUID, status: 'accepted' | 'rejected') => {
      const prior = app.repos.events.byID(id)
      // Append-only review ledger (spec 12.9) + current-state flag on the event.
      app.repos.reviews.add({
        targetKind: 'event', targetID: id, action: status,
        priorValue: prior?.reviewStatus ?? null, newValue: status
      })
      app.repos.events.setReview(id, status)
    },
    'ledger.exportReport': async () => {
      const { buildChronologyReport } = await import('./knowledge/reportBuilder')
      return { markdown: buildChronologyReport(app.repos) }
    },

    // ── convert ──
    'convert.file': async (path: string) => {
      const st = detectSourceType(path)
      const docs = await loadFile(path, st)
      return { text: docs.map((d) => d.content).join('\n\n---\n\n'), sourceType: st }
    },
    'convert.text': async (text: string, _from: string, to: string) => {
      if (to === 'summary') return { output: extractiveSummary(text, 4) }
      if (to === 'markdown') return { output: text.split(/\n{2,}/).map((p) => p.trim()).join('\n\n') }
      if (to === 'plain') return { output: text.replace(/[#*_`>]/g, '').trim() }
      return { output: text }
    },

    // ── settings (server-config driven; read-mostly on the hosted version) ──
    'settings.get': async (): Promise<Preferences> => ({
      privacyAllowCloud: config.allowCloud, ollamaBaseURL: config.ollama.baseURL,
      ollamaModelTag: config.ollama.model, ollamaEmbeddingTag: config.ollama.embed,
      cloudProvider: config.cloud.provider, cloudModel: config.cloud.model, cloudApiKeySet: !!config.cloud.key,
      theme: 'dark', enableLLMExtraction: true
    }),
    'settings.set': async () => ({
      privacyAllowCloud: config.allowCloud, ollamaBaseURL: config.ollama.baseURL,
      ollamaModelTag: config.ollama.model, ollamaEmbeddingTag: config.ollama.embed,
      cloudProvider: config.cloud.provider, cloudModel: config.cloud.model, cloudApiKeySet: !!config.cloud.key,
      theme: 'dark', enableLLMExtraction: true
    }),
    'settings.providers': async () => app.capabilities.statuses(),
    'settings.ollamaModels': async () => {
      const { OllamaProvider } = await import('./routing/providers/ollama')
      return new OllamaProvider({ baseURL: config.ollama.baseURL, modelTag: config.ollama.model, embeddingModelTag: config.ollama.embed }).listModels()
    },
    'settings.setCloudKey': async () => { /* cloud key is server-managed on the hosted version */ }
  }
}
