//
// userApp.ts — the per-user service container. Same wiring as the desktop
// AppState (Storage → Brain), but scoped to ONE user's isolated ledger and
// with no Electron. Cloud + Ollama come from server env (config), routed by
// the CapabilityRegistry: local Ollama if reachable, cloud fallback.
//

import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { Repos } from './storage'
import { PrivacyGate } from './routing/privacyGate'
import { CapabilityRegistry } from './routing/capabilityRegistry'
import { OllamaProvider } from './routing/providers/ollama'
import { CloudProvider } from './routing/providers/cloud'
import { RuleIntentDetector } from './routing/intentDetector'
import { DeterministicRouter } from './routing/router'
import { HybridRetriever } from './retrieval/hybridRetriever'
import { MasterBrain } from './brain/masterBrain'
import { IngestCoordinator } from './ingestion/coordinator'
import { GraphStore } from './knowledge/graphStore'
import { TimelineEngine } from './knowledge/timelineEngine'
import { Summarizer } from './knowledge/summarizer'
import { MemoryDistiller } from './knowledge/memoryDistiller'
import { userLedgerOpts } from './storage/driver'
import { userMetaPath } from './paths'
import { config } from './config'
import { log } from './core/logger'
import type { KnowledgeInventory } from '../shared/ipc'
import { sourceCategory, type SourceType } from '../shared/models'

interface UserMeta { roots: string[]; onboardingShown: boolean }

export class UserApp {
  readonly userId: string
  readonly repos: Repos
  readonly gate: PrivacyGate
  readonly capabilities: CapabilityRegistry
  readonly retriever: HybridRetriever
  readonly brain: MasterBrain
  readonly coordinator: IngestCoordinator
  readonly graph: GraphStore
  readonly timeline: TimelineEngine
  readonly summarizer: Summarizer
  readonly distiller: MemoryDistiller
  lastUsed = Date.now()
  private meta: UserMeta = { roots: [], onboardingShown: false }

  /** Repos opens asynchronously (libSQL) — construct via `UserApp.create`. */
  static async create(userId: string): Promise<UserApp> {
    const repos = await Repos.open(await userLedgerOpts(userId))
    return new UserApp(userId, repos)
  }

  private constructor(userId: string, repos: Repos) {
    this.userId = userId
    this.repos = repos
    this.loadMeta()

    this.gate = new PrivacyGate(config.allowCloud)
    this.capabilities = new CapabilityRegistry(this.gate)
    this.capabilities.register(new OllamaProvider({
      baseURL: config.ollama.baseURL, modelTag: config.ollama.model, embeddingModelTag: config.ollama.embed
    }))
    if (config.cloud.provider !== 'none' && config.cloud.key) {
      this.capabilities.register(new CloudProvider({
        provider: config.cloud.provider, model: config.cloud.model, apiKey: config.cloud.key
      }))
    }

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
    log.app(`UserApp ready for ${userId.slice(0, 8)} (schema v${this.repos.ledger.schemaVersion})`)
  }

  touch(): void { this.lastUsed = Date.now() }

  private loadMeta(): void {
    try {
      if (existsSync(userMetaPath(this.userId))) this.meta = { ...this.meta, ...JSON.parse(readFileSync(userMetaPath(this.userId), 'utf8')) }
    } catch (err) { log.app.warn(`meta load failed: ${String(err)}`) }
  }
  private saveMeta(): void {
    try { writeFileSync(userMetaPath(this.userId), JSON.stringify(this.meta, null, 2), 'utf8') } catch (err) { log.app.error('meta save', err) }
  }
  roots(): string[] { return this.meta.roots }
  addRoot(p: string): void { if (!this.meta.roots.includes(p)) { this.meta.roots.push(p); this.saveMeta() } }
  removeRoot(p: string): void { this.meta.roots = this.meta.roots.filter((r) => r !== p); this.saveMeta() }
  get onboardingShown(): boolean { return this.meta.onboardingShown }
  markOnboardingShown(): void { this.meta.onboardingShown = true; this.saveMeta() }

  async inventory(): Promise<KnowledgeInventory> {
    const cats = await this.repos.files.countByCategory()
    const byCategory: Record<string, number> = {}
    for (const [st, n] of Object.entries(cats)) {
      const cat = sourceCategory(st as SourceType)
      byCategory[cat] = (byCategory[cat] ?? 0) + n
    }
    const bounds = await this.repos.events.bounds()
    return {
      files: await this.repos.files.count(), objects: await this.repos.objects.count(), chunks: await this.repos.chunks.count(),
      entities: await this.repos.entities.count(), events: await this.repos.events.count(), relationships: await this.repos.relationships.count(),
      memories: await this.repos.memory.count(), summaries: await this.repos.summaries.count(), assertions: await this.repos.assertions.count(),
      vectors: await this.repos.vectors.count(), byCategory, earliestEvent: bounds.earliest, latestEvent: bounds.latest
    }
  }

  async postIngest(): Promise<void> {
    try { await this.distiller.distillTop(10) } catch (err) { log.knowledge.warn(`postIngest distill failed: ${String(err)}`) }
  }

  close(): void { this.repos.close() }
}

// Keep a tiny helper for temp paths under the user's dir.
export function userUploadPath(userId: string, filename: string): string {
  return join('data', 'users', userId, 'uploads', filename)
}
