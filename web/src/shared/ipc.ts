//
// ipc.ts — the typed contract between the Electron main process (backend)
// and the React renderer (UI). `window.km` is the preload-exposed surface;
// every screen talks to the backend only through this interface.
//

import type {
  KnowledgeObject, Entity, KEvent, Relationship, MemoryObject, Summary,
  Assertion, EventLink, FileRow, UUID, SourceCategory, EvidenceBlock,
  LedgerClaim, LedgerContradiction, IngestionRun, EpistemicStatus
} from './models'
import type {
  VerifiedAnswer, ProviderStatus, RetrievalResult, UserIntent
} from './ai'

// ── App / boot ──────────────────────────────────────────────────────────

export type BootPhase = 'starting' | 'ready' | 'failed'

export interface AppStatus {
  phase: BootPhase
  message?: string
  databasePath: string
  schemaVersion: number
  hasRoots: boolean
  onboardingShown: boolean
}

export interface IngestActivity {
  activeCount: number
  lastFile: string | null
  totalFiles: number
  totalObjects: number
}

// ── Knowledge inventory / stats ─────────────────────────────────────────

export interface KnowledgeInventory {
  files: number
  objects: number
  chunks: number
  entities: number
  events: number
  relationships: number
  memories: number
  summaries: number
  assertions: number
  vectors: number
  byCategory: Record<string, number>
  earliestEvent: number | null
  latestEvent: number | null
}

// ── Search ──────────────────────────────────────────────────────────────

export interface SearchHit {
  objectID: UUID
  chunkID?: UUID | null
  sourceFile: string
  sourceCategory: SourceCategory
  snippet: string
  score: number
  via: 'fts' | 'vector' | 'entity'
}

// ── Timeline ────────────────────────────────────────────────────────────

export interface TimelineQuery {
  start?: number | null
  end?: number | null
  entityID?: UUID | null
  kinds?: string[] | null
  limit?: number
}

// ── Dossier ─────────────────────────────────────────────────────────────

export interface EntityDossier {
  entity: Entity
  aliases: string[]
  mentionCount: number
  events: KEvent[]
  relationships: Relationship[]
  neighbors: { entity: Entity; weight: number }[]
  memory: MemoryObject | null
  firstSeen: number | null
  lastSeen: number | null
  sourceObjectIDs: UUID[]
}

// ── Graph / explore ─────────────────────────────────────────────────────

export interface GraphNode {
  id: UUID
  label: string
  kind: string
  weight: number
}
export interface GraphEdge {
  from: UUID
  to: UUID
  kind: string
  weight: number
}
export interface GraphNeighborhood {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// ── Investigations (Notebook) ───────────────────────────────────────────

export interface InvestigationStep {
  id: UUID
  ordinal: number
  question: string
  answerBody: string | null
  answerConfidence: number | null
  answerCitations: UUID[]
  createdAt: number
}
export interface Investigation {
  id: UUID
  question: string
  synthesis: string | null
  createdAt: number
  finishedAt: number | null
  steps: InvestigationStep[]
}

// ── Saved queries ───────────────────────────────────────────────────────

export interface SavedQuery {
  id: UUID
  question: string
  title: string | null
  notes: string | null
  category: string | null
  createdAt: number
  lastRunAt: number | null
}

// ── Live metrics ────────────────────────────────────────────────────────

export interface LiveSample {
  at: number
  ingestActive: number
  objects: number
  chunks: number
  entities: number
  events: number
  vectors: number
  pipeline: Record<string, number>
  services: { name: string; healthy: boolean; detail: string }[]
}

// ── Settings / preferences ──────────────────────────────────────────────

export interface Preferences {
  privacyAllowCloud: boolean
  ollamaBaseURL: string
  ollamaModelTag: string
  ollamaEmbeddingTag: string
  cloudProvider: 'anthropic' | 'openai' | 'none'
  cloudModel: string
  cloudApiKeySet: boolean
  theme: 'dark' | 'light'
  enableLLMExtraction: boolean
}

export interface OllamaModelInfo {
  name: string
  sizeBytes: number
  family?: string
}

// ── Evidence ledger DTOs ────────────────────────────────────────────────

export interface MissingProofItem {
  kind: 'single_source' | 'unfulfilled_obligation' | 'timeline_gap' | 'low_confidence_date'
  description: string
  relatedEventID?: UUID | null
  relatedClaimID?: UUID | null
  severity: 'info' | 'warn'
}

export interface FactMatrix {
  observed: number
  asserted: number
  derived: number
  inferred: number
  contradicted: number
  unsupported: number
  totalEvents: number
  corroborated: number
  contradictions: number
  missingProof: number
}

// ── Ask streaming updates ───────────────────────────────────────────────

export type AskUpdate =
  | { id: string; kind: 'instant'; body: string }
  | { id: string; kind: 'token'; delta: string }
  | { id: string; kind: 'chapter'; title: string; body: string }
  | { id: string; kind: 'stage'; label: string }
  | { id: string; kind: 'verified'; answer: VerifiedAnswer }
  | { id: string; kind: 'error'; message: string }

/** Distributive Omit so each union member keeps its own fields. */
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never
/** An AskUpdate without the `id` — the backend adds the id at push time. */
export type AskUpdateBody = DistributiveOmit<AskUpdate, 'id'>

// ── The full API surface exposed on window.km ───────────────────────────

export interface KalsmritikoshApi {
  app: {
    status(): Promise<AppStatus>
    inventory(): Promise<KnowledgeInventory>
    ingestActivity(): Promise<IngestActivity>
    markOnboardingShown(): Promise<void>
    openPath(path: string): Promise<void>
  }
  ingest: {
    pickFiles(): Promise<string[]>
    pickFolder(): Promise<string | null>
    addPaths(paths: string[]): Promise<{ queued: number }>
    listFiles(limit?: number): Promise<FileRow[]>
    reingest(fileID: UUID): Promise<void>
    remove(fileID: UUID): Promise<void>
    roots(): Promise<string[]>
    addRoot(path: string): Promise<void>
    removeRoot(path: string): Promise<void>
  }
  ask: {
    ask(question: string): Promise<VerifiedAnswer>
    start(question: string): Promise<{ id: string }>
    onUpdate(cb: (u: AskUpdate) => void): () => void
    conversations(): Promise<{ id: UUID; title: string | null; startedAt: number }[]>
    detectIntent(question: string): Promise<UserIntent>
    retrieveOnly(question: string): Promise<RetrievalResult>
  }
  search: {
    query(text: string, limit?: number): Promise<SearchHit[]>
    semantic(text: string, limit?: number): Promise<SearchHit[]>
  }
  timeline: {
    events(q: TimelineQuery): Promise<KEvent[]>
    eventDetail(id: UUID): Promise<{ event: KEvent; entities: Entity[]; object: KnowledgeObject | null }>
    causalLinks(eventID: UUID): Promise<EventLink[]>
  }
  knowledge: {
    entities(kind?: string, limit?: number): Promise<Entity[]>
    events(limit?: number): Promise<KEvent[]>
    memories(): Promise<MemoryObject[]>
    summaries(level?: string): Promise<Summary[]>
    objects(limit?: number): Promise<KnowledgeObject[]>
    objectContent(id: UUID): Promise<KnowledgeObject | null>
  }
  dossier: {
    forEntity(id: UUID): Promise<EntityDossier | null>
    search(name: string): Promise<Entity[]>
  }
  graph: {
    neighborhood(entityID: UUID, hops?: number): Promise<GraphNeighborhood>
    topEntities(limit?: number): Promise<GraphNode[]>
  }
  assertions: {
    list(subjectID?: UUID): Promise<Assertion[]>
    add(a: Omit<Assertion, 'id' | 'recordedAt' | 'retractedAt'>): Promise<Assertion>
    retract(id: UUID): Promise<void>
  }
  notebook: {
    list(): Promise<Investigation[]>
    get(id: UUID): Promise<Investigation | null>
    run(question: string): Promise<Investigation>
    remove(id: UUID): Promise<void>
  }
  saved: {
    list(): Promise<SavedQuery[]>
    add(question: string, title?: string, notes?: string): Promise<SavedQuery>
    remove(id: UUID): Promise<void>
    touch(id: UUID): Promise<void>
  }
  live: {
    sample(): Promise<LiveSample>
  }
  ledger: {
    blocks(objectID: UUID): Promise<EvidenceBlock[]>
    claims(objectID?: UUID, limit?: number): Promise<LedgerClaim[]>
    contradictions(): Promise<LedgerContradiction[]>
    contradictionDetail(id: UUID): Promise<{ contradiction: LedgerContradiction; a: KEvent | null; b: KEvent | null }>
    missingProof(): Promise<MissingProofItem[]>
    factMatrix(): Promise<FactMatrix>
    ingestionRuns(limit?: number): Promise<IngestionRun[]>
    eventsByStatus(status?: EpistemicStatus, limit?: number): Promise<KEvent[]>
    reviewEvent(id: UUID, status: 'accepted' | 'rejected'): Promise<void>
    exportReport(): Promise<{ markdown: string }>
  }
  convert: {
    file(path: string): Promise<{ text: string; sourceType: string }>
    text(text: string, from: string, to: string): Promise<{ output: string }>
  }
  settings: {
    get(): Promise<Preferences>
    set(patch: Partial<Preferences>): Promise<Preferences>
    providers(): Promise<ProviderStatus[]>
    ollamaModels(): Promise<OllamaModelInfo[]>
    setCloudKey(key: string): Promise<void>
  }
}

// Channel prefix used for main→renderer pushes (ask streaming, ingest ticks).
export const PUSH_CHANNEL = 'km:push'
export const INVOKE_CHANNEL = 'km:invoke'
