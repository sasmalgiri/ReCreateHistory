//
// models.ts — the normalized domain model, ported from Swift Core/Models.
//
// The intelligence of Kalsmritikosh lives in this structured ledger, not
// in the model. Every fact carries source IDs, a date, and a confidence.
// IDs are UUID strings. Timestamps are epoch milliseconds (number).
//

export type UUID = string
/** Epoch milliseconds. */
export type Timestamp = number

/** Confidence value in [0,1]. In Swift this is a struct; here a plain number. */
export type Confidence = number

export const Confidence = {
  zero: 0.0,
  low: 0.33,
  medium: 0.66,
  high: 0.9,
  certain: 1.0,
  clamp(v: number): number {
    return Math.max(0, Math.min(1, v))
  },
  /** noisy-OR: probability at least one independent source is right. */
  combined(a: Confidence, b: Confidence): Confidence {
    return 1.0 - (1.0 - a) * (1.0 - b)
  }
}

/**
 * HISTORY Phase A quality tier. T1 = trusted structured fact (email headers,
 * ICS attendees); T2 = body-text NER (historical default); T3 = shape-flagged
 * noise, preserved on disk but demoted at retrieval.
 */
export type QualityTier = 'T1' | 'T2' | 'T3'

/**
 * Wikidata-style temporal precision. Travels WITH the timestamp — never
 * reconstruct precision from a midnight-padded date.
 */
export enum DatePrecision {
  unknown = 0,
  billionYears = 1,
  millionYears = 2,
  century = 4,
  decade = 5, // note: Swift uses 5=day as default; we keep day below
  year = 9,
  month = 10,
  day = 11,
  hour = 12,
  minute = 13,
  instant = 14
}

// ── SourceType ──────────────────────────────────────────────────────────

export type SourceType =
  // Documents
  | 'pdf' | 'docx' | 'doc' | 'txt' | 'markdown' | 'rtf' | 'odt' | 'epub'
  // Spreadsheets
  | 'xlsx' | 'xls' | 'csv' | 'ods'
  // Presentations
  | 'pptx' | 'ppt' | 'keynote'
  // Email
  | 'mbox' | 'pst' | 'eml' | 'msg' | 'appleMail' | 'nsf'
  // Images
  | 'png' | 'jpg' | 'heic' | 'tiff' | 'webp'
  // Audio
  | 'mp3' | 'wav' | 'm4a' | 'aac'
  // Video
  | 'mp4' | 'mov'
  // Archives
  | 'zip' | 'rar' | 'sevenZip'
  // Chat + browser
  | 'imessage' | 'safariHistory' | 'chromeHistory' | 'chatExport'
  // JSON/HTML web content
  | 'html' | 'json'
  | 'unknown'

export type SourceCategory =
  | 'document' | 'spreadsheet' | 'presentation' | 'email' | 'image'
  | 'audio' | 'video' | 'archive' | 'chat' | 'browserHistory' | 'web' | 'unknown'

// ── Entities ────────────────────────────────────────────────────────────

export type EntityKind =
  | 'person' | 'emailAddress' | 'phoneNumber'
  | 'organization' | 'vendor' | 'client'
  | 'money' | 'currency' | 'invoiceNumber' | 'paymentID'
  | 'date' | 'deadline' | 'milestone'
  | 'address' | 'city' | 'country' | 'location'
  | 'project' | 'deliverable'
  | 'other'

export interface SourceRange {
  chunkID?: UUID | null
  characterRange?: { lower: number; upper: number } | null
  pageNumber?: number | null
  line?: number | null
}

export interface Entity {
  id: UUID
  kind: EntityKind
  value: string
  normalizedValue?: string | null
  sourceObjectID: UUID
  sourceRange?: SourceRange | null
  confidence: Confidence
  attributes: Record<string, unknown>
  qualityTier: QualityTier
}

// ── Events (the verb layer, drives the Timeline) ────────────────────────

export type EventKind =
  | 'emailSent' | 'emailReceived' | 'contractSigned' | 'contractModified'
  | 'invoiceIssued' | 'invoicePaid' | 'meetingHeld' | 'taskAssigned'
  | 'deliveryDelayed' | 'deliveryCompleted' | 'other'

export interface KEvent {
  id: UUID
  kind: EventKind
  date: Timestamp
  endDate?: Timestamp | null
  title: string
  summary?: string | null
  entityIDs: UUID[]
  sourceObjectID: UUID
  sourceRange?: SourceRange | null
  confidence: Confidence
  /** Confidence in the DATE specifically (0.95 header, 0.7 body, 0.3 mtime). */
  dateConfidence: number
  attributes: Record<string, unknown>
  qualityTier: QualityTier
  datePrecision: DatePrecision
  /** Fact Status Matrix: how this event is known.
   *  observed = structured source (email header, log, timestamp);
   *  asserted = stated in body text; derived = computed from stated facts;
   *  inferred = indirect (e.g. file mtime); contradicted; unsupported. */
  epistemicStatus: EpistemicStatus
  /** Distinct source documents backing this event. */
  corroborationCount: number
  statusReason?: string | null
  reviewStatus: 'unreviewed' | 'accepted' | 'rejected'
}

export type EpistemicStatus =
  | 'observed' | 'asserted' | 'derived' | 'inferred' | 'contradicted' | 'unsupported'

// ── Relationships (graph edges) ─────────────────────────────────────────

export type RelationshipKind =
  | 'worksWith' | 'sent' | 'received' | 'mentioned' | 'paid' | 'contracted'
  | 'partOf' | 'owns' | 'manages' | 'reportsTo' | 'other'
  | 'co_occurs' | 'event_linked' | 'emailed' | 'affiliated'

export interface Relationship {
  id: UUID
  kind: RelationshipKind
  fromEntityID: UUID
  toEntityID: UUID
  viaEventID?: UUID | null
  sourceObjectID: UUID
  confidence: Confidence
  weight: number
  evidenceObjectIDs: UUID[]
  attributes: Record<string, unknown>
}

// ── Chunk ───────────────────────────────────────────────────────────────

export interface Chunk {
  id: UUID
  objectID: UUID
  ordinal: number
  text: string
  characterRange: { lower: number; upper: number }
  pageNumber?: number | null
  createdAt: Timestamp
  /** Contextual-retrieval prefix — used ONLY at embed time, never shown. */
  contextPrefix?: string | null
  contextPrefixSource?: string | null
}

// ── KnowledgeObject (the normalized unit) ───────────────────────────────

export interface KnowledgeObject {
  id: UUID
  sourceFile: string // file path / URL
  sourceType: SourceType
  content: string
  metadata: Record<string, unknown>
  entities: UUID[]
  events: UUID[]
  relationships: UUID[]
  summaries: UUID[]
  confidence: Confidence
  createdAt: Timestamp
  updatedAt: Timestamp
}

// ── MemoryObject (distilled state per subject) ──────────────────────────

export type SubjectKind = 'project' | 'organization' | 'person' | 'deliverable' | 'topic'
export type RiskSeverity = 'low' | 'medium' | 'high' | 'critical'

export interface MemoryDecision {
  summary: string
  madeOn?: Timestamp | null
  sourceObjectID?: UUID | null
  confidence: Confidence
}

export interface MemoryRisk {
  description: string
  severity: RiskSeverity
  sourceObjectIDs: UUID[]
  confidence: Confidence
}

export interface MemoryObject {
  id: UUID
  subjectKind: SubjectKind
  subjectIdentifier: string
  keyDecisions: MemoryDecision[]
  keyEventIDs: UUID[]
  importantRelationshipIDs: UUID[]
  risks: MemoryRisk[]
  status: string
  narrative: string
  sourceObjectIDs: UUID[]
  confidence: Confidence
  version: number
  createdAt: Timestamp
  updatedAt: Timestamp
  qualityTier: QualityTier
}

// ── Summary (6-level hierarchy) ─────────────────────────────────────────

export type SummaryLevel =
  | 'document' | 'folder' | 'project' | 'organization' | 'timeline' | 'knowledgeBase'
export type SummaryLength = 'short' | 'medium' | 'executive'

export interface Summary {
  id: UUID
  level: SummaryLevel
  length: SummaryLength
  scope: unknown // JSON-encoded Scope
  body: string
  producedAt: Timestamp
  modelID?: string | null
  confidence: Confidence
}

// ── Assertion substrate (Vol 17 §A3) ────────────────────────────────────

export interface Assertion {
  id: UUID
  subjectKind: string
  subjectID: string
  predicate: string
  objectKind: string
  objectValue?: string | null
  objectEntityID?: UUID | null
  objectEventID?: UUID | null
  confidence: Confidence
  evidenceObjectIDs: UUID[]
  agent: string
  reason?: string | null
  recordedAt: Timestamp
  retractedAt?: Timestamp | null
}

// ── Causal / event links ────────────────────────────────────────────────

export type CausalRelation =
  | 'CAUSED' | 'CONTRIBUTED_TO' | 'ENABLED' | 'PREVENTED' | 'FOLLOWED'

export interface EventLink {
  id: UUID
  sourceEventID: UUID
  targetEventID: UUID
  relation: CausalRelation
  confidence: Confidence
  evidenceObjectIDs: UUID[]
  allen?: string | null
  source: string
  reason?: string | null
  createdAt: Timestamp
  supersededBy?: UUID | null
}

// ── Files ───────────────────────────────────────────────────────────────

export type FileAvailability = 'available' | 'offline' | 'missing'

export interface FileRow {
  id: UUID
  url: string
  sourceType: SourceType
  sizeBytes: number
  modifiedAt: Timestamp
  ingestedAt?: Timestamp | null
  contentHash?: string | null
  aliasOf?: UUID | null
  availability: FileAvailability
}

// ── Files → File source category helper ─────────────────────────────────

export function sourceCategory(t: SourceType): SourceCategory {
  switch (t) {
    case 'pdf': case 'docx': case 'doc': case 'txt': case 'markdown':
    case 'rtf': case 'odt': case 'epub': return 'document'
    case 'xlsx': case 'xls': case 'csv': case 'ods': return 'spreadsheet'
    case 'pptx': case 'ppt': case 'keynote': return 'presentation'
    case 'mbox': case 'pst': case 'eml': case 'msg': case 'appleMail': case 'nsf': return 'email'
    case 'png': case 'jpg': case 'heic': case 'tiff': case 'webp': return 'image'
    case 'mp3': case 'wav': case 'm4a': case 'aac': return 'audio'
    case 'mp4': case 'mov': return 'video'
    case 'zip': case 'rar': case 'sevenZip': return 'archive'
    case 'imessage': case 'chatExport': return 'chat'
    case 'safariHistory': case 'chromeHistory': return 'browserHistory'
    case 'html': case 'json': return 'web'
    default: return 'unknown'
  }
}

// ── Evidence Ledger objects (v28–v31) ───────────────────────────────────

export type BlockType =
  | 'paragraph' | 'heading' | 'table_row' | 'email_message' | 'image'
  | 'ocr_text' | 'code' | 'log_event' | 'slide' | 'audio_transcript'

export type ExtractionMethod = 'native' | 'ocr' | 'vision' | 'asr' | 'manual'

export interface EvidenceBlock {
  id: UUID
  objectID: UUID
  ordinal: number
  blockType: BlockType
  text?: string | null
  structuredData: Record<string, unknown>
  page?: number | null
  sheet?: string | null
  rowNum?: number | null
  charStart?: number | null
  charEnd?: number | null
  sectionPath: string[]
  /** Human-readable anchor, e.g. "contract.pdf, page 8, Payment Terms". */
  citation: string
  extractionMethod: ExtractionMethod
  extractionConfidence: number
  createdAt: Timestamp
}

export type ClaimType =
  | 'statement' | 'obligation' | 'date_assertion' | 'amount' | 'communication'

export interface LedgerClaim {
  id: UUID
  claimText: string
  claimType: ClaimType
  assertedBy?: string | null
  sourceObjectID: UUID
  evidenceBlockIDs: UUID[]
  confidence: Confidence
  extractionMethod: string
  createdAt: Timestamp
}

export interface LedgerContradiction {
  id: UUID
  kind: string
  aKind: 'event' | 'claim'
  aID: UUID
  bKind: 'event' | 'claim'
  bID: UUID
  explanation: string
  resolutionStatus: 'unresolved' | 'resolved' | 'dismissed'
  detectedAt: Timestamp
}

export interface IngestionRun {
  id: UUID
  fileID: UUID
  parser: string
  status: 'parsing' | 'indexed' | 'low_confidence' | 'failed' | 'unsupported' | 'needs_ocr' | 'duplicate'
  blocks: number
  chunks: number
  tableRows: number
  claims: number
  embeddings: number
  warnings: string[]
  startedAt: Timestamp
  finishedAt?: Timestamp | null
}

export interface TableRow {
  id: UUID
  objectID: UUID
  sheet?: string | null
  rowNum: number
  columns: Record<string, string>
  createdAt: Timestamp
}
