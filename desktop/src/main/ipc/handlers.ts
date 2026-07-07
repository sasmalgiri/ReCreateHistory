//
// handlers.ts — the backend half of the IPC contract. Every window.km call
// lands here via a single INVOKE_CHANNEL dispatcher; streaming answers and
// ingest ticks are pushed back over PUSH_CHANNEL.
//

import { ipcMain, dialog, shell, type BrowserWindow } from 'electron'
import { INVOKE_CHANNEL, PUSH_CHANNEL } from '../../shared/ipc'
import type {
  AppStatus, IngestActivity, SearchHit, EntityDossier, LiveSample, TimelineQuery
} from '../../shared/ipc'
import type { AppState } from '../app/appState'
import { detectSourceType } from '../ingestion/sourceType'
import { loadFile } from '../ingestion/loaders'
import { extractiveSummary } from '../knowledge/summarizer'
import { sourceCategory } from '../../shared/models'
import type { UUID, Assertion } from '../../shared/models'
import { newID } from '../core/ids'
import { log } from '../core/logger'

export function registerIpc(app: AppState, getWindow: () => BrowserWindow | null): void {
  const push = (topic: string, payload: unknown): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(PUSH_CHANNEL, { topic, payload })
  }

  // Stream ingest activity to the renderer.
  app.coordinator.onActivity((s) => push('ingest', { activeCount: s.activeCount, lastFile: s.lastFile }))

  const handlers: Record<string, (...args: any[]) => any> = {
    // ── app ──
    'app.status': async (): Promise<AppStatus> => ({
      phase: app.phase, message: app.message,
      databasePath: app.repos?.ledger.path ?? '',
      schemaVersion: app.repos?.ledger.schemaVersion ?? 0,
      hasRoots: app.roots().length > 0,
      onboardingShown: app.onboardingShown
    }),
    'app.inventory': async () => app.inventory(),
    'app.ingestActivity': async (): Promise<IngestActivity> => ({
      activeCount: app.coordinator.state.activeCount,
      lastFile: app.coordinator.state.lastFile,
      totalFiles: app.repos.files.count(),
      totalObjects: app.repos.objects.count()
    }),
    'app.markOnboardingShown': async () => { app.markOnboardingShown() },
    'app.openPath': async (p: string) => { await shell.openPath(p) },

    // ── ingest ──
    'ingest.pickFiles': async (): Promise<string[]> => {
      const r = await dialog.showOpenDialog(getWindow()!, {
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Documents', extensions: ['pdf', 'docx', 'txt', 'md', 'csv', 'html', 'json', 'eml', 'mbox', 'rtf'] }, { name: 'All', extensions: ['*'] }]
      })
      return r.canceled ? [] : r.filePaths
    },
    'ingest.pickFolder': async (): Promise<string | null> => {
      const r = await dialog.showOpenDialog(getWindow()!, { properties: ['openDirectory'] })
      return r.canceled ? null : r.filePaths[0]
    },
    'ingest.addPaths': async (paths: string[]) => {
      // Fire-and-forget; progress streams via the ingest push topic.
      ;(async () => {
        const res = await app.coordinator.ingestPaths(paths)
        log.ingestion(`ingest batch done: +${res.ingested} (${res.skipped} skipped)`)
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
    'ingest.addRoot': async (p: string) => { app.addRoot(p); await handlers['ingest.addPaths']([p]) },
    'ingest.removeRoot': async (p: string) => { app.removeRoot(p) },

    // ── ask ──
    'ask.ask': async (question: string) => app.brain.ask(question),
    'ask.start': async (question: string) => {
      const id = newID()
      ;(async () => {
        try {
          await app.brain.askStream(question, (u) => push('ask', { id, ...u }))
        } catch (err) {
          push('ask', { id, kind: 'error', message: String(err) })
        }
      })()
      return { id }
    },
    'ask.conversations': async () => app.repos.conversations.list(),
    'ask.detectIntent': async (question: string) => {
      const { RuleIntentDetector } = await import('../routing/intentDetector')
      return new RuleIntentDetector().detect(question)
    },
    'ask.retrieveOnly': async (question: string) => {
      const { RuleIntentDetector } = await import('../routing/intentDetector')
      const intent = new RuleIntentDetector().detect(question)
      const { RETRIEVAL_PRIORITY } = await import('../../shared/ai')
      return app.retriever.retrieve(intent, RETRIEVAL_PRIORITY)
    },

    // ── search ──
    'search.query': async (text: string, limit?: number): Promise<SearchHit[]> => {
      const ranks = app.repos.chunks.ftsSearch(text, limit ?? 30)
      const hits: SearchHit[] = []
      for (const r of ranks) {
        const c = app.repos.chunks.byID(r.chunkID)
        if (!c) continue
        const ko = app.repos.objects.byID(c.objectID)
        if (!ko) continue
        hits.push({
          objectID: ko.id, chunkID: c.id, sourceFile: ko.sourceFile,
          sourceCategory: sourceCategory(ko.sourceType), snippet: c.text.slice(0, 240),
          score: -r.rank, via: 'fts'
        })
      }
      return hits
    },
    'search.semantic': async (text: string, limit?: number): Promise<SearchHit[]> => {
      const qvec = await app.capabilities.embed(text)
      if (!qvec) return []
      const near = app.repos.vectors.nearest(qvec, limit ?? 30)
      const hits: SearchHit[] = []
      for (const n of near) {
        const c = app.repos.chunks.byID(n.chunkID)
        if (!c) continue
        const ko = app.repos.objects.byID(c.objectID)
        if (!ko) continue
        hits.push({
          objectID: ko.id, chunkID: c.id, sourceFile: ko.sourceFile,
          sourceCategory: sourceCategory(ko.sourceType), snippet: c.text.slice(0, 240),
          score: n.score, via: 'vector'
        })
      }
      return hits
    },

    // ── timeline ──
    'timeline.events': async (q: TimelineQuery) => app.timeline.events(q),
    'timeline.eventDetail': async (id: UUID) => {
      const event = app.repos.events.byID(id)
      if (!event) return { event: null, entities: [], object: null }
      const entities = app.repos.events.entitiesFor(id).map((eid) => app.repos.entities.byID(eid)).filter(Boolean)
      const object = app.repos.objects.byID(event.sourceObjectID)
      return { event, entities, object }
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
      const neighborhood = app.graph.neighborhood(id, 1)
      const neighbors = neighborhood.nodes.filter((n) => n.id !== id).map((n) => ({
        entity: app.repos.entities.byID(n.id)!, weight: n.weight
      })).filter((x) => x.entity).slice(0, 20)
      const subjectKind = ['organization', 'vendor', 'client'].includes(entity.kind) ? 'organization'
        : entity.kind === 'person' ? 'person' : entity.kind === 'project' ? 'project' : 'topic'
      const memory = app.repos.memory.bySubject(subjectKind as any, entity.normalizedValue ?? entity.value.toLowerCase())
      const dates = events.map((e) => e.date)
      return {
        entity, aliases: app.repos.entities.aliases(id), mentionCount: app.repos.entities.mentionCount(id),
        events, relationships, neighbors, memory,
        firstSeen: dates.length ? Math.min(...dates) : null,
        lastSeen: dates.length ? Math.max(...dates) : null,
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
      const { missingProof } = await import('../knowledge/factStatus')
      return missingProof(app.repos)
    },
    'ledger.factMatrix': async () => {
      const { factMatrix } = await import('../knowledge/factStatus')
      return factMatrix(app.repos)
    },
    'ledger.ingestionRuns': async (limit?: number) => app.repos.ingestionRuns.list(limit ?? 100),
    'ledger.eventsByStatus': async (status?: string, limit?: number) =>
      app.repos.events.byStatus(status as never, limit ?? 300),
    'ledger.reviewEvent': async (id: UUID, status: 'accepted' | 'rejected') => {
      const prior = app.repos.events.byID(id)
      app.repos.reviews.add({
        targetKind: 'event', targetID: id, action: status,
        priorValue: prior?.reviewStatus ?? null, newValue: status
      })
      app.repos.events.setReview(id, status)
    },
    'ledger.exportReport': async () => {
      const { buildChronologyReport } = await import('../knowledge/reportBuilder')
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

    // ── settings ──
    'settings.get': async () => app.prefs.get(),
    'settings.set': async (patch: any) => {
      const next = app.prefs.set(patch)
      app.registerProviders()
      return next
    },
    'settings.providers': async () => app.capabilities.statuses(),
    'settings.ollamaModels': async () => {
      const { OllamaProvider } = await import('../routing/providers/ollama')
      const p = app.prefs.get()
      const provider = new OllamaProvider({ baseURL: p.ollamaBaseURL, modelTag: p.ollamaModelTag, embeddingModelTag: p.ollamaEmbeddingTag || null })
      return provider.listModels()
    },
    'settings.setCloudKey': async (key: string) => { app.prefs.setApiKey(key); app.registerProviders() }
  }

  ipcMain.handle(INVOKE_CHANNEL, async (_e, path: string, args: unknown[]) => {
    const fn = handlers[path]
    if (!fn) throw new Error(`Unknown IPC method: ${path}`)
    try {
      return await fn(...(args ?? []))
    } catch (err) {
      log.ipc.error(`handler ${path} failed`, err)
      throw err
    }
  })
}
