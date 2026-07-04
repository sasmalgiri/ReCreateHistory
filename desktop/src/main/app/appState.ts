//
// appState.ts — single root container. Owns every long-lived service from
// Storage through Brain. Ported from App/AppState.swift. Wires capability
// resolution, ingestion, retrieval, knowledge distillation, and the brain.
//

import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { Repos } from '../storage'
import { PreferencesStore } from './preferences'
import { PrivacyGate } from '../routing/privacyGate'
import { CapabilityRegistry } from '../routing/capabilityRegistry'
import { OllamaProvider } from '../routing/providers/ollama'
import { CloudProvider } from '../routing/providers/cloud'
import { RuleIntentDetector } from '../routing/intentDetector'
import { DeterministicRouter } from '../routing/router'
import { HybridRetriever } from '../retrieval/hybridRetriever'
import { MasterBrain } from '../brain/masterBrain'
import { IngestCoordinator } from '../ingestion/coordinator'
import { GraphStore } from '../knowledge/graphStore'
import { TimelineEngine } from '../knowledge/timelineEngine'
import { Summarizer } from '../knowledge/summarizer'
import { MemoryDistiller } from '../knowledge/memoryDistiller'
import { defaultDatabasePath, dataDir } from '../core/paths'
import { log } from '../core/logger'
import type { KnowledgeInventory } from '../../shared/ipc'
import { sourceCategory } from '../../shared/models'
import type { SourceType } from '../../shared/models'

interface AppMeta {
  roots: string[]
  onboardingShown: boolean
}

export class AppState {
  phase: 'starting' | 'ready' | 'failed' = 'starting'
  message = ''
  repos!: Repos
  prefs!: PreferencesStore
  gate!: PrivacyGate
  capabilities!: CapabilityRegistry
  retriever!: HybridRetriever
  brain!: MasterBrain
  coordinator!: IngestCoordinator
  graph!: GraphStore
  timeline!: TimelineEngine
  summarizer!: Summarizer
  distiller!: MemoryDistiller
  private meta: AppMeta = { roots: [], onboardingShown: false }

  private metaPath(): string {
    return join(dataDir(), 'appmeta.json')
  }

  async boot(dbPath = defaultDatabasePath()): Promise<void> {
    try {
      this.prefs = new PreferencesStore()
      this.loadMeta()

      // ── Storage ──
      this.repos = new Repos(dbPath)
      log.storage(`ledger open at ${this.repos.ledger.path} (schema v${this.repos.ledger.schemaVersion})`)

      // ── Routing / capabilities ──
      this.gate = new PrivacyGate(this.prefs.get().privacyAllowCloud)
      this.capabilities = new CapabilityRegistry(this.gate)
      this.registerProviders()

      // ── Knowledge / retrieval / brain ──
      this.summarizer = new Summarizer(this.capabilities)
      this.distiller = new MemoryDistiller(this.repos, this.summarizer)
      this.graph = new GraphStore(this.repos)
      this.timeline = new TimelineEngine(this.repos)
      this.retriever = new HybridRetriever(this.repos, this.capabilities)
      this.brain = new MasterBrain({
        repos: this.repos, capabilities: this.capabilities, retriever: this.retriever,
        intentDetector: new RuleIntentDetector(), router: new DeterministicRouter()
      })
      this.coordinator = new IngestCoordinator(this.repos, this.capabilities)

      this.phase = 'ready'
      log.app('boot complete — ready')
    } catch (err) {
      this.phase = 'failed'
      this.message = String(err)
      log.app.error('boot failed', err)
    }
  }

  /** (Re)register providers from current preferences. Called on boot + on
   *  settings change so the Ollama tag / cloud key take effect live. */
  registerProviders(): void {
    const p = this.prefs.get()
    this.gate.allowCloud = p.privacyAllowCloud
    this.capabilities.clear()
    this.capabilities.register(new OllamaProvider({
      baseURL: p.ollamaBaseURL, modelTag: p.ollamaModelTag,
      embeddingModelTag: p.ollamaEmbeddingTag || null
    }))
    if (p.cloudProvider !== 'none' && this.prefs.getApiKey()) {
      this.capabilities.register(new CloudProvider({
        provider: p.cloudProvider, model: p.cloudModel, apiKey: this.prefs.getApiKey()
      }))
    }
  }

  // ── Meta (roots + onboarding) ──
  private loadMeta(): void {
    try {
      if (existsSync(this.metaPath())) this.meta = { ...this.meta, ...JSON.parse(readFileSync(this.metaPath(), 'utf8')) }
    } catch (err) {
      log.app.warn(`meta load failed: ${String(err)}`)
    }
  }
  private saveMeta(): void {
    try { writeFileSync(this.metaPath(), JSON.stringify(this.meta, null, 2), 'utf8') } catch (err) { log.app.error('meta save', err) }
  }
  roots(): string[] { return this.meta.roots }
  addRoot(p: string): void { if (!this.meta.roots.includes(p)) { this.meta.roots.push(p); this.saveMeta() } }
  removeRoot(p: string): void { this.meta.roots = this.meta.roots.filter((r) => r !== p); this.saveMeta() }
  get onboardingShown(): boolean { return this.meta.onboardingShown }
  markOnboardingShown(): void { this.meta.onboardingShown = true; this.saveMeta() }

  // ── Inventory ──
  inventory(): KnowledgeInventory {
    const cats = this.repos.files.countByCategory()
    const byCategory: Record<string, number> = {}
    for (const [st, n] of Object.entries(cats)) {
      const cat = sourceCategory(st as SourceType)
      byCategory[cat] = (byCategory[cat] ?? 0) + n
    }
    const bounds = this.repos.events.bounds()
    return {
      files: this.repos.files.count(),
      objects: this.repos.objects.count(),
      chunks: this.repos.chunks.count(),
      entities: this.repos.entities.count(),
      events: this.repos.events.count(),
      relationships: this.repos.relationships.count(),
      memories: this.repos.memory.count(),
      summaries: this.repos.summaries.count(),
      assertions: this.repos.assertions.count(),
      vectors: this.repos.vectors.count(),
      byCategory,
      earliestEvent: bounds.earliest,
      latestEvent: bounds.latest
    }
  }

  /** Distill memory for top entities after an ingest batch. */
  async postIngest(): Promise<void> {
    try {
      await this.distiller.distillTop(10)
    } catch (err) {
      log.knowledge.warn(`postIngest distill failed: ${String(err)}`)
    }
  }
}
