//
// ai.ts — capability routing, retrieval, experts, and the verified-answer
// contract. Ported from Swift Core/Services + Routing + Brain.
//
// Capability discipline: callers declare a CapabilitySpec (what the call
// must achieve) and the CapabilityRegistry resolves it to a provider.
// No caller names a model.
//

import type { Confidence, KEvent, Entity, Relationship, Summary, Chunk, UUID } from './models'

// ── Model capabilities & providers ──────────────────────────────────────

export type ModelCapability =
  | 'textGeneration' | 'structuredOutput' | 'toolCalling' | 'embedding'
  | 'vision' | 'longContext'
  | 'reasoning' | 'summarization' | 'extraction' | 'classification'
  | 'routing' | 'complexityAnalysis' | 'reranking'
  | 'routerSmall' | 'expertLarge'

export type PrivacyLevel = 'onDevice' | 'localNetwork' | 'cloud'
export type LatencyHint = 'interactive' | 'background' | 'bulk'
export type ModelTier = 'small' | 'medium' | 'large'

export interface GenerationOptions {
  maxTokens: number
  temperature: number
  topP: number
  stopSequences: string[]
  systemPrompt?: string | null
}

export const defaultGenerationOptions: GenerationOptions = {
  maxTokens: 1024,
  temperature: 0.4,
  topP: 0.95,
  stopSequences: [],
  systemPrompt: null
}

export interface ModelManifest {
  id: string
  displayName: string
  capabilities: ModelCapability[]
  minRAMBytes: number
  diskBytes: number
  contextWindow: number
  privacyLevel: PrivacyLevel
  requiresDownload: boolean
  tier: ModelTier
}

export interface CapabilitySpec {
  requires: ModelCapability[]
  prefers: ModelCapability[]
  maxLatency: LatencyHint
  privacy: PrivacyLevel
  estimatedContextTokens: number
  purpose: string
}

// ── Intent & routing ────────────────────────────────────────────────────

export type IntentKind =
  | 'factualLookup' | 'reconstructTimeline' | 'reconstructProject'
  | 'reconstructRelationship' | 'executiveBriefing' | 'riskDetection'
  | 'missingInformation' | 'semanticSearch' | 'unknown'

export type IntentScope =
  | { type: 'global' }
  | { type: 'project'; value: string }
  | { type: 'person'; value: string }
  | { type: 'organization'; value: string }
  | { type: 'folder'; value: string }

export interface Timeframe {
  start?: number | null
  end?: number | null
}

export interface UserIntent {
  kind: IntentKind
  scope: IntentScope
  timeframe?: Timeframe | null
  entityHints: string[]
  rawQuestion: string
}

export type RetrievalLayer =
  | 'memory' | 'timeline' | 'entity' | 'metadata' | 'summary' | 'graph' | 'vector'

/** Locked retrieval priority — structure first, similarity last. */
export const RETRIEVAL_PRIORITY: RetrievalLayer[] = [
  'memory', 'timeline', 'entity', 'metadata', 'summary', 'graph', 'vector'
]

export interface RoutingDecision {
  answerSpec: CapabilitySpec
  expertIDs: string[]
  retrievalLayers: RetrievalLayer[]
  parallelism: number
  complexity: number // 1..5
  rationale: string
}

// ── Retrieval result ────────────────────────────────────────────────────

export interface RetrievedChunk {
  chunk: Chunk
  score: number
  viaLayer: RetrievalLayer
}

export interface WalkStep {
  fromFactKind: string
  fromFactID: UUID
  bondName: string
  toFactKind: string
  toFactID: UUID
  explanation: string
}

export interface RetrievalResult {
  chunks: RetrievedChunk[]
  events: KEvent[]
  entities: Entity[]
  relationships: Relationship[]
  summaries: Summary[]
  layersUsed: RetrievalLayer[]
  shortCircuitedAt?: RetrievalLayer | null
  walkSteps: WalkStep[]
}

export function emptyRetrieval(): RetrievalResult {
  return {
    chunks: [], events: [], entities: [], relationships: [], summaries: [],
    layersUsed: [], shortCircuitedAt: null, walkSteps: []
  }
}

// ── Experts ─────────────────────────────────────────────────────────────

export type ExpertDomain =
  | 'email' | 'financial' | 'legal' | 'research' | 'ocr' | 'timeline' | 'project'

export type EvidenceGranularity = 'specific' | 'coarse'

export interface Claim {
  statement: string
  supportingObjectIDs: UUID[]
  supportingEventIDs: UUID[]
  supportingEntityIDs: UUID[]
  confidence: Confidence
  evidenceGranularity: EvidenceGranularity
}

export interface ExpertFindings {
  expertID: string
  claims: Claim[]
  confidence: Confidence
  notes?: string | null
  droppedUnverifiable: number
}

// ── Verified answer (the evidence gate output) ──────────────────────────

export type AnswerSource =
  | 'historical' | 'ragFallback' | 'experts' | 'memoryCache' | 'unknown'

export const answerSourceDisplay: Record<AnswerSource, string> = {
  historical: 'Historical reconstruction',
  ragFallback: 'RAG (chunk grounded)',
  experts: 'Expert pipeline',
  memoryCache: 'Memory cache',
  unknown: 'Unknown'
}

export interface Citation {
  objectID: UUID
  chunkID?: UUID | null
  eventID?: UUID | null
  snippet: string
}

export interface Contradiction {
  description: string
  claimA: string
  claimB: string
}

export interface ConfidenceReport {
  finalConfidence: Confidence
  evidenceCount: number
  eventCount: number
  entityCount: number
  freshnessDays?: number | null
  temporalCoverageDays?: number | null
  conflictCount: number
  droppedUnverifiable: number
  agreement: number
  diversity: number
}

export interface ReasoningTraceStep {
  label: string
  detail: string
}

export interface ReasoningTrace {
  layersFired: RetrievalLayer[]
  expertsRun: string[]
  llmPurposes: string[]
  steps: ReasoningTraceStep[]
  assumptions: string[]
  uncertainties: string[]
}

export interface VerifiedAnswer {
  body: string
  answerText?: string | null
  intentKind?: string | null
  citations: Citation[]
  confidence: Confidence
  contradictions: Contradiction[]
  refused: boolean
  refusalReason?: string | null
  report?: ConfidenceReport | null
  walkSteps: WalkStep[]
  source: AnswerSource
  reasoningTrace?: ReasoningTrace | null
}

// ── Provider status (surfaced to Settings) ──────────────────────────────

export interface ProviderStatus {
  id: string
  displayName: string
  privacyLevel: PrivacyLevel
  capabilities: ModelCapability[]
  available: boolean
  detail: string
  modelTag?: string
}
