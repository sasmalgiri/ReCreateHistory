//
// repositories.ts — typed access to every table. In Swift these are the
// classes in Storage/Repositories/ behind the Database actor. Here they wrap
// a shared better-sqlite3 handle. Only these classes touch SQL; the rest of
// the app works with domain models.
//

import type { Ledger } from './database'
import { newID, nowMs } from '../core/ids'
import type {
  FileRow, KnowledgeObject, Chunk, Entity, KEvent, Relationship, MemoryObject,
  Summary, Assertion, EventLink, SourceType, EntityKind, EventKind, QualityTier,
  RelationshipKind, SubjectKind, UUID, EvidenceBlock, LedgerClaim, ClaimType,
  LedgerContradiction, IngestionRun, TableRow, EpistemicStatus, BlockType,
  ExtractionMethod
} from '../../shared/models'
import { DatePrecision } from '../../shared/models'

const j = (v: unknown): string => JSON.stringify(v ?? null)
const pj = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback
  try { return JSON.parse(s) as T } catch { return fallback }
}

// ── Files ───────────────────────────────────────────────────────────────

export class FilesRepo {
  constructor(private L: Ledger) {}

  upsert(row: Omit<FileRow, 'id'> & { id?: UUID }): FileRow {
    const existing = this.byURL(row.url)
    if (existing) return existing
    const id = row.id ?? newID()
    this.L.db.prepare(
      `INSERT INTO files (id,url,source_type,size_bytes,modified_at,ingested_at,content_hash,availability,alias_of)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(id, row.url, row.sourceType, row.sizeBytes, row.modifiedAt,
      row.ingestedAt ?? null, row.contentHash ?? null, row.availability ?? 'available', row.aliasOf ?? null)
    return { ...row, id }
  }

  /** Exact-duplicate lookup: same SHA-256 already ingested (dedup, spec step 4). */
  byHash(hash: string): FileRow | null {
    const r = this.L.db.prepare(
      `SELECT * FROM files WHERE content_hash=? AND ingested_at IS NOT NULL AND alias_of IS NULL LIMIT 1`
    ).get(hash) as any
    return r ? mapFile(r) : null
  }

  markIngested(id: UUID): void {
    this.L.db.prepare(`UPDATE files SET ingested_at=? WHERE id=?`).run(nowMs(), id)
  }

  byURL(url: string): FileRow | null {
    const r = this.L.db.prepare(`SELECT * FROM files WHERE url=?`).get(url) as any
    return r ? mapFile(r) : null
  }
  byID(id: UUID): FileRow | null {
    const r = this.L.db.prepare(`SELECT * FROM files WHERE id=?`).get(id) as any
    return r ? mapFile(r) : null
  }
  list(limit = 500): FileRow[] {
    return (this.L.db.prepare(`SELECT * FROM files ORDER BY ingested_at DESC NULLS LAST, modified_at DESC LIMIT ?`)
      .all(limit) as any[]).map(mapFile)
  }
  remove(id: UUID): void {
    this.L.db.prepare(`DELETE FROM files WHERE id=?`).run(id)
  }
  count(): number {
    return Number((this.L.db.prepare(`SELECT COUNT(*) c FROM files`).get() as any).c)
  }
  countByCategory(): Record<string, number> {
    const rows = this.L.db.prepare(`SELECT source_type, COUNT(*) c FROM files GROUP BY source_type`).all() as any[]
    const out: Record<string, number> = {}
    for (const r of rows) out[r.source_type] = Number(r.c)
    return out
  }
}

function mapFile(r: any): FileRow {
  return {
    id: r.id, url: r.url, sourceType: r.source_type as SourceType,
    sizeBytes: Number(r.size_bytes), modifiedAt: Number(r.modified_at),
    ingestedAt: r.ingested_at != null ? Number(r.ingested_at) : null,
    contentHash: r.content_hash ?? null, aliasOf: r.alias_of ?? null,
    availability: r.availability ?? 'available'
  }
}

// ── Knowledge objects ───────────────────────────────────────────────────

export class ObjectsRepo {
  constructor(private L: Ledger) {}

  insert(ko: Partial<KnowledgeObject> & { fileID: UUID; sourceType: SourceType; content: string }): KnowledgeObject {
    const id = ko.id ?? newID()
    const now = nowMs()
    this.L.db.prepare(
      `INSERT INTO knowledge_objects (id,file_id,source_type,content,metadata_json,confidence,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(id, ko.fileID, ko.sourceType, ko.content, j(ko.metadata ?? {}), ko.confidence ?? 1.0, now, now)
    return {
      id, sourceFile: ko.sourceFile ?? '', sourceType: ko.sourceType, content: ko.content,
      metadata: ko.metadata ?? {}, entities: [], events: [], relationships: [], summaries: [],
      confidence: ko.confidence ?? 1.0, createdAt: now, updatedAt: now
    }
  }
  byID(id: UUID): KnowledgeObject | null {
    const r = this.L.db.prepare(
      `SELECT k.*, f.url AS file_url FROM knowledge_objects k JOIN files f ON f.id=k.file_id WHERE k.id=?`
    ).get(id) as any
    return r ? mapKO(r) : null
  }
  list(limit = 200): KnowledgeObject[] {
    return (this.L.db.prepare(
      `SELECT k.*, f.url AS file_url FROM knowledge_objects k JOIN files f ON f.id=k.file_id
       ORDER BY k.created_at DESC LIMIT ?`
    ).all(limit) as any[]).map(mapKO)
  }
  count(): number {
    return Number((this.L.db.prepare(`SELECT COUNT(*) c FROM knowledge_objects`).get() as any).c)
  }
}

function mapKO(r: any): KnowledgeObject {
  return {
    id: r.id, sourceFile: r.file_url ?? '', sourceType: r.source_type,
    content: r.content, metadata: pj(r.metadata_json, {}), entities: [], events: [],
    relationships: [], summaries: [], confidence: Number(r.confidence),
    createdAt: Number(r.created_at), updatedAt: Number(r.updated_at)
  }
}

// ── Chunks ──────────────────────────────────────────────────────────────

export class ChunksRepo {
  constructor(private L: Ledger) {}

  insertMany(chunks: Chunk[]): void {
    const stmt = this.L.db.prepare(
      `INSERT INTO chunks (id,object_id,ordinal,text,char_start,char_end,page_number,created_at,context_prefix,context_prefix_source)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    const tx = this.L.db.transaction((rows: Chunk[]) => {
      for (const c of rows) {
        stmt.run(c.id, c.objectID, c.ordinal, c.text, c.characterRange.lower, c.characterRange.upper,
          c.pageNumber ?? null, c.createdAt, c.contextPrefix ?? null, c.contextPrefixSource ?? null)
      }
    })
    tx(chunks)
  }
  byObject(objectID: UUID): Chunk[] {
    return (this.L.db.prepare(`SELECT * FROM chunks WHERE object_id=? ORDER BY ordinal`).all(objectID) as any[]).map(mapChunk)
  }
  byID(id: UUID): Chunk | null {
    const r = this.L.db.prepare(`SELECT * FROM chunks WHERE id=?`).get(id) as any
    return r ? mapChunk(r) : null
  }
  byIDs(ids: UUID[]): Chunk[] {
    if (!ids.length) return []
    const q = ids.map(() => '?').join(',')
    return (this.L.db.prepare(`SELECT * FROM chunks WHERE id IN (${q})`).all(...ids) as any[]).map(mapChunk)
  }
  count(): number {
    return Number((this.L.db.prepare(`SELECT COUNT(*) c FROM chunks`).get() as any).c)
  }
  /** FTS search over chunk text. Returns chunkID + bm25 rank (lower = better).
   *  mode 'and' requires all content terms in a chunk (precision); 'or' is the
   *  recall fallback. The retriever runs the AND→OR ladder. */
  ftsSearch(query: string, limit = 40, mode: 'and' | 'or' = 'or'): { chunkID: UUID; rank: number }[] {
    const match = toFtsMatch(query, mode)
    if (!match) return []
    try {
      const rows = this.L.db.prepare(
        `SELECT c.id AS id, bm25(chunks_fts) AS rank
         FROM chunks_fts JOIN chunks c ON c.rowid = chunks_fts.rowid
         WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?`
      ).all(match, limit) as any[]
      return rows.map((r) => ({ chunkID: r.id, rank: Number(r.rank) }))
    } catch {
      return []
    }
  }
}

function mapChunk(r: any): Chunk {
  return {
    id: r.id, objectID: r.object_id, ordinal: Number(r.ordinal), text: r.text,
    characterRange: { lower: Number(r.char_start), upper: Number(r.char_end) },
    pageNumber: r.page_number != null ? Number(r.page_number) : null,
    createdAt: Number(r.created_at), contextPrefix: r.context_prefix ?? null,
    contextPrefixSource: r.context_prefix_source ?? null
  }
}

/** Question words that carry no retrieval signal — they only dilute bm25. */
const FTS_STOP = new Set([
  'the', 'and', 'was', 'were', 'what', 'when', 'who', 'whom', 'which', 'how',
  'why', 'where', 'did', 'does', 'have', 'has', 'had', 'that', 'this', 'with',
  'from', 'for', 'are', 'about', 'tell', 'give', 'show', 'happened', 'between'
])

/** Turn free text into a safe FTS5 MATCH expression of prefix terms.
 *  'and' = all terms must match (implicit FTS5 AND); 'or' = any term. */
export function toFtsMatch(query: string, mode: 'and' | 'or' = 'or'): string | null {
  const terms = (query.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((t) => t.length > 1 && !FTS_STOP.has(t))
  if (!terms.length) return null
  const quoted = [...new Set(terms)].map((t) => `"${t}"*`)
  return quoted.join(mode === 'and' ? ' ' : ' OR ')
}

// ── Entities ────────────────────────────────────────────────────────────

export class EntitiesRepo {
  constructor(private L: Ledger) {}

  /** Upsert canonical entity (UNIQUE on kind+normalized). Returns entity id. */
  upsertCanonical(e: {
    kind: EntityKind; value: string; normalized?: string; sourceObjectID: UUID;
    confidence?: number; qualityTier?: QualityTier
  }): UUID {
    const normalized = (e.normalized ?? e.value).toLowerCase().trim()
    const found = this.L.db.prepare(`SELECT id FROM entities WHERE kind=? AND normalized=?`).get(e.kind, normalized) as any
    if (found) return found.id
    const id = newID()
    this.L.db.prepare(
      `INSERT INTO entities (id,kind,value,normalized,source_object_id,confidence,attributes_json,quality_tier)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(id, e.kind, e.value, normalized, e.sourceObjectID, e.confidence ?? 0.5, '{}', e.qualityTier ?? 'T2')
    return id
  }
  addMention(entityID: UUID, kind: EntityKind, surface: string, normalized: string, sourceObjectID: UUID, confidence = 0.5): void {
    this.L.db.prepare(
      `INSERT INTO entity_mentions (id,entity_id,kind,surface,normalized,source_object_id,confidence)
       VALUES (?,?,?,?,?,?,?)`
    ).run(newID(), entityID, kind, surface, normalized, sourceObjectID, confidence)
  }
  byID(id: UUID): Entity | null {
    const r = this.L.db.prepare(`SELECT * FROM entities WHERE id=?`).get(id) as any
    return r ? mapEntity(r) : null
  }
  list(kind?: string, limit = 300): Entity[] {
    const rows = kind
      ? this.L.db.prepare(`SELECT e.*, (SELECT COUNT(*) FROM entity_mentions m WHERE m.entity_id=e.id) mc
          FROM entities e WHERE kind=? ORDER BY mc DESC LIMIT ?`).all(kind, limit)
      : this.L.db.prepare(`SELECT e.*, (SELECT COUNT(*) FROM entity_mentions m WHERE m.entity_id=e.id) mc
          FROM entities e ORDER BY mc DESC LIMIT ?`).all(limit)
    return (rows as any[]).map(mapEntity)
  }
  search(name: string, limit = 25): Entity[] {
    const q = `%${name.toLowerCase()}%`
    return (this.L.db.prepare(`SELECT * FROM entities WHERE normalized LIKE ? OR lower(value) LIKE ? LIMIT ?`)
      .all(q, q, limit) as any[]).map(mapEntity)
  }
  mentionCount(id: UUID): number {
    return Number((this.L.db.prepare(`SELECT COUNT(*) c FROM entity_mentions WHERE entity_id=?`).get(id) as any).c)
  }
  aliases(id: UUID): string[] {
    return (this.L.db.prepare(`SELECT alias_normalized a FROM entity_aliases WHERE entity_id=?`).all(id) as any[]).map((r) => r.a)
  }
  /** ENTITY_ALIAS_OF — e.g. "Alice Smith" ↔ alice@acme.com from email headers. */
  addAlias(entityID: UUID, alias: string, source: string): void {
    this.L.db.prepare(`INSERT OR IGNORE INTO entity_aliases (entity_id,alias_normalized,source) VALUES (?,?,?)`)
      .run(entityID, alias.toLowerCase().trim(), source)
  }
  count(): number {
    return Number((this.L.db.prepare(`SELECT COUNT(*) c FROM entities`).get() as any).c)
  }
}

function mapEntity(r: any): Entity {
  return {
    id: r.id, kind: r.kind, value: r.value, normalizedValue: r.normalized ?? null,
    sourceObjectID: r.source_object_id, confidence: Number(r.confidence),
    attributes: pj(r.attributes_json, {}), qualityTier: (r.quality_tier ?? 'T2') as QualityTier
  }
}

// ── Events ──────────────────────────────────────────────────────────────

export class EventsRepo {
  constructor(private L: Ledger) {}

  insert(e: {
    kind: EventKind; date: number; endDate?: number | null; title: string; summary?: string | null;
    entityIDs?: UUID[]; sourceObjectID: UUID; confidence?: number; dateConfidence?: number;
    qualityTier?: QualityTier; datePrecision?: DatePrecision;
    epistemicStatus?: EpistemicStatus; statusReason?: string | null
  }): KEvent {
    const id = newID()
    this.L.db.prepare(
      `INSERT INTO events (id,kind,date,end_date,title,summary,source_object_id,confidence,attributes_json,date_confidence,quality_tier,date_precision,narrative_slots_json,slot_values_json,epistemic_status,corroboration_count,status_reason,review_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(id, e.kind, e.date, e.endDate ?? null, e.title, e.summary ?? null, e.sourceObjectID,
      e.confidence ?? 0.5, '{}', e.dateConfidence ?? 0.5, e.qualityTier ?? 'T2',
      e.datePrecision ?? DatePrecision.day, '{}', '{}',
      e.epistemicStatus ?? 'asserted', 1, e.statusReason ?? null, 'unreviewed')
    for (const eid of e.entityIDs ?? []) {
      this.L.db.prepare(`INSERT OR IGNORE INTO event_entities (event_id,entity_id) VALUES (?,?)`).run(id, eid)
    }
    return mapEvent(this.L.db.prepare(`SELECT * FROM events WHERE id=?`).get(id))
  }
  byID(id: UUID): KEvent | null {
    const r = this.L.db.prepare(`SELECT * FROM events WHERE id=?`).get(id) as any
    return r ? mapEvent(r) : null
  }
  inRange(start?: number | null, end?: number | null, limit = 400): KEvent[] {
    const s = start ?? -8.64e15, e = end ?? 8.64e15
    return (this.L.db.prepare(`SELECT * FROM events WHERE date>=? AND date<=? ORDER BY date DESC LIMIT ?`)
      .all(s, e, limit) as any[]).map(mapEvent)
  }
  forEntity(entityID: UUID, limit = 200): KEvent[] {
    return (this.L.db.prepare(
      `SELECT e.* FROM events e JOIN event_entities ee ON ee.event_id=e.id WHERE ee.entity_id=? ORDER BY e.date DESC LIMIT ?`
    ).all(entityID, limit) as any[]).map(mapEvent)
  }
  entitiesFor(eventID: UUID): UUID[] {
    return (this.L.db.prepare(`SELECT entity_id FROM event_entities WHERE event_id=?`).all(eventID) as any[]).map((r) => r.entity_id)
  }
  list(limit = 200): KEvent[] {
    return (this.L.db.prepare(`SELECT * FROM events ORDER BY date DESC LIMIT ?`).all(limit) as any[]).map(mapEvent)
  }
  count(): number {
    return Number((this.L.db.prepare(`SELECT COUNT(*) c FROM events`).get() as any).c)
  }
  bounds(): { earliest: number | null; latest: number | null } {
    const r = this.L.db.prepare(`SELECT MIN(date) mn, MAX(date) mx FROM events`).get() as any
    return { earliest: r?.mn != null ? Number(r.mn) : null, latest: r?.mx != null ? Number(r.mx) : null }
  }
  all(limit = 5000): KEvent[] {
    return (this.L.db.prepare(`SELECT * FROM events ORDER BY date ASC LIMIT ?`).all(limit) as any[]).map(mapEvent)
  }
  byStatus(status?: EpistemicStatus, limit = 300): KEvent[] {
    const rows = status
      ? this.L.db.prepare(`SELECT * FROM events WHERE epistemic_status=? ORDER BY date DESC LIMIT ?`).all(status, limit)
      : this.L.db.prepare(`SELECT * FROM events ORDER BY date DESC LIMIT ?`).all(limit)
    return (rows as any[]).map(mapEvent)
  }
  setFactStatus(id: UUID, status: EpistemicStatus, corroboration: number, reason: string): void {
    this.L.db.prepare(`UPDATE events SET epistemic_status=?, corroboration_count=?, status_reason=? WHERE id=?`)
      .run(status, corroboration, reason, id)
  }
  setReview(id: UUID, review: 'accepted' | 'rejected'): void {
    this.L.db.prepare(`UPDATE events SET review_status=? WHERE id=?`).run(review, id)
  }
  statusCounts(): Record<string, number> {
    const rows = this.L.db.prepare(`SELECT epistemic_status s, COUNT(*) c FROM events GROUP BY epistemic_status`).all() as any[]
    const out: Record<string, number> = {}
    for (const r of rows) out[r.s] = Number(r.c)
    return out
  }
  corroboratedCount(): number {
    return Number((this.L.db.prepare(`SELECT COUNT(*) c FROM events WHERE corroboration_count >= 2`).get() as any).c)
  }
}

function mapEvent(r: any): KEvent {
  return {
    id: r.id, kind: r.kind, date: Number(r.date),
    endDate: r.end_date != null ? Number(r.end_date) : null, title: r.title,
    summary: r.summary ?? null, entityIDs: [], sourceObjectID: r.source_object_id,
    confidence: Number(r.confidence), dateConfidence: Number(r.date_confidence ?? 0.5),
    attributes: pj(r.attributes_json, {}), qualityTier: (r.quality_tier ?? 'T2') as QualityTier,
    datePrecision: Number(r.date_precision ?? DatePrecision.day),
    epistemicStatus: (r.epistemic_status ?? 'asserted') as EpistemicStatus,
    corroborationCount: Number(r.corroboration_count ?? 1),
    statusReason: r.status_reason ?? null,
    reviewStatus: (r.review_status ?? 'unreviewed') as KEvent['reviewStatus']
  }
}

// ── Relationships ───────────────────────────────────────────────────────

export class RelationshipsRepo {
  constructor(private L: Ledger) {}

  upsert(rel: {
    kind: RelationshipKind; fromEntityID: UUID; toEntityID: UUID; sourceObjectID: UUID;
    viaEventID?: UUID | null; confidence?: number
  }): void {
    this.L.db.prepare(
      `INSERT INTO relationships (id,kind,from_entity_id,to_entity_id,via_event_id,source_object_id,confidence,attributes_json,weight,evidence_object_ids_json)
       VALUES (?,?,?,?,?,?,?,?,1,?)
       ON CONFLICT(kind,from_entity_id,to_entity_id) DO UPDATE SET weight=weight+1`
    ).run(newID(), rel.kind, rel.fromEntityID, rel.toEntityID, rel.viaEventID ?? null,
      rel.sourceObjectID, rel.confidence ?? 0.5, '{}', '[]')
  }
  forEntity(entityID: UUID, limit = 200): Relationship[] {
    return (this.L.db.prepare(
      `SELECT * FROM relationships WHERE from_entity_id=? OR to_entity_id=? ORDER BY weight DESC LIMIT ?`
    ).all(entityID, entityID, limit) as any[]).map(mapRel)
  }
  count(): number {
    return Number((this.L.db.prepare(`SELECT COUNT(*) c FROM relationships`).get() as any).c)
  }
}

function mapRel(r: any): Relationship {
  return {
    id: r.id, kind: r.kind, fromEntityID: r.from_entity_id, toEntityID: r.to_entity_id,
    viaEventID: r.via_event_id ?? null, sourceObjectID: r.source_object_id,
    confidence: Number(r.confidence), weight: Number(r.weight ?? 1),
    evidenceObjectIDs: pj(r.evidence_object_ids_json, []), attributes: pj(r.attributes_json, {})
  }
}

// ── Memory ──────────────────────────────────────────────────────────────

export class MemoryRepo {
  constructor(private L: Ledger) {}

  upsert(m: {
    subjectKind: SubjectKind; subjectIdentifier: string; narrative: string;
    keyEventIDs?: UUID[]; sourceObjectIDs?: UUID[]; confidence?: number; status?: string;
    keyDecisions?: MemoryObject['keyDecisions']; risks?: MemoryObject['risks']; qualityTier?: QualityTier
  }): void {
    const now = nowMs()
    const existing = this.bySubject(m.subjectKind, m.subjectIdentifier)
    if (existing) {
      this.L.db.prepare(
        `UPDATE memory_objects SET narrative=?, key_event_ids_json=?, source_object_ids_json=?,
         key_decisions_json=?, risks_json=?, confidence=?, status=?, version=version+1, updated_at=?
         WHERE subject_kind=? AND subject_identifier=?`
      ).run(m.narrative, j(m.keyEventIDs ?? []), j(m.sourceObjectIDs ?? []),
        j(m.keyDecisions ?? []), j(m.risks ?? []), m.confidence ?? 0.5, m.status ?? 'active',
        now, m.subjectKind, m.subjectIdentifier)
    } else {
      this.L.db.prepare(
        `INSERT INTO memory_objects (id,subject_kind,subject_identifier,key_decisions_json,key_event_ids_json,
         important_relationship_ids_json,risks_json,status,narrative,source_object_ids_json,confidence,version,created_at,updated_at,quality_tier)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`
      ).run(newID(), m.subjectKind, m.subjectIdentifier, j(m.keyDecisions ?? []), j(m.keyEventIDs ?? []),
        '[]', j(m.risks ?? []), m.status ?? 'active', m.narrative, j(m.sourceObjectIDs ?? []),
        m.confidence ?? 0.5, now, now, m.qualityTier ?? 'T2')
    }
  }
  bySubject(kind: SubjectKind, identifier: string): MemoryObject | null {
    const r = this.L.db.prepare(`SELECT * FROM memory_objects WHERE subject_kind=? AND subject_identifier=?`)
      .get(kind, identifier) as any
    return r ? mapMemory(r) : null
  }
  list(limit = 200): MemoryObject[] {
    return (this.L.db.prepare(`SELECT * FROM memory_objects ORDER BY updated_at DESC LIMIT ?`).all(limit) as any[]).map(mapMemory)
  }
  count(): number {
    return Number((this.L.db.prepare(`SELECT COUNT(*) c FROM memory_objects`).get() as any).c)
  }
}

function mapMemory(r: any): MemoryObject {
  return {
    id: r.id, subjectKind: r.subject_kind, subjectIdentifier: r.subject_identifier,
    keyDecisions: pj(r.key_decisions_json, []), keyEventIDs: pj(r.key_event_ids_json, []),
    importantRelationshipIDs: pj(r.important_relationship_ids_json, []), risks: pj(r.risks_json, []),
    status: r.status, narrative: r.narrative, sourceObjectIDs: pj(r.source_object_ids_json, []),
    confidence: Number(r.confidence), version: Number(r.version),
    createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
    qualityTier: (r.quality_tier ?? 'T2') as QualityTier
  }
}

// ── Summaries ───────────────────────────────────────────────────────────

export class SummariesRepo {
  constructor(private L: Ledger) {}
  insert(s: { level: Summary['level']; length: Summary['length']; scope: unknown; body: string; modelID?: string | null; confidence?: number }): void {
    this.L.db.prepare(
      `INSERT INTO summaries (id,level,length,scope_json,body,produced_at,model_id,confidence) VALUES (?,?,?,?,?,?,?,?)`
    ).run(newID(), s.level, s.length, j(s.scope), s.body, nowMs(), s.modelID ?? null, s.confidence ?? 0.5)
  }
  list(level?: string, limit = 100): Summary[] {
    const rows = level
      ? this.L.db.prepare(`SELECT * FROM summaries WHERE level=? ORDER BY produced_at DESC LIMIT ?`).all(level, limit)
      : this.L.db.prepare(`SELECT * FROM summaries ORDER BY produced_at DESC LIMIT ?`).all(limit)
    return (rows as any[]).map(mapSummary)
  }
  count(): number {
    return Number((this.L.db.prepare(`SELECT COUNT(*) c FROM summaries`).get() as any).c)
  }
}

function mapSummary(r: any): Summary {
  return {
    id: r.id, level: r.level, length: r.length, scope: pj(r.scope_json, {}), body: r.body,
    producedAt: Number(r.produced_at), modelID: r.model_id ?? null, confidence: Number(r.confidence)
  }
}

// ── Conversations ───────────────────────────────────────────────────────

export class ConversationsRepo {
  constructor(private L: Ledger) {}
  create(title?: string): UUID {
    const id = newID()
    this.L.db.prepare(`INSERT INTO conversations (id,started_at,title) VALUES (?,?,?)`).run(id, nowMs(), title ?? null)
    return id
  }
  addTurn(conversationID: UUID, ordinal: number, role: 'user' | 'assistant', body: string): void {
    this.L.db.prepare(`INSERT INTO conversation_turns (id,conversation_id,ordinal,role,body,created_at) VALUES (?,?,?,?,?,?)`)
      .run(newID(), conversationID, ordinal, role, body, nowMs())
  }
  list(limit = 50): { id: UUID; title: string | null; startedAt: number }[] {
    return (this.L.db.prepare(`SELECT id,title,started_at FROM conversations ORDER BY started_at DESC LIMIT ?`).all(limit) as any[])
      .map((r) => ({ id: r.id, title: r.title ?? null, startedAt: Number(r.started_at) }))
  }
}

// ── Saved queries ───────────────────────────────────────────────────────

export class SavedQueriesRepo {
  constructor(private L: Ledger) {}
  add(question: string, title?: string, notes?: string, category?: string): any {
    const id = newID(); const now = nowMs()
    this.L.db.prepare(`INSERT INTO saved_queries (id,question,title,notes,category,created_at,last_run_at) VALUES (?,?,?,?,?,?,?)`)
      .run(id, question, title ?? null, notes ?? null, category ?? null, now, null)
    return this.get(id)
  }
  get(id: UUID): any {
    const r = this.L.db.prepare(`SELECT * FROM saved_queries WHERE id=?`).get(id) as any
    return r ? mapSaved(r) : null
  }
  list(): any[] {
    return (this.L.db.prepare(`SELECT * FROM saved_queries ORDER BY created_at DESC`).all() as any[]).map(mapSaved)
  }
  remove(id: UUID): void { this.L.db.prepare(`DELETE FROM saved_queries WHERE id=?`).run(id) }
  touch(id: UUID): void { this.L.db.prepare(`UPDATE saved_queries SET last_run_at=? WHERE id=?`).run(nowMs(), id) }
}
function mapSaved(r: any): any {
  return { id: r.id, question: r.question, title: r.title ?? null, notes: r.notes ?? null,
    category: r.category ?? null, createdAt: Number(r.created_at), lastRunAt: r.last_run_at != null ? Number(r.last_run_at) : null }
}

// ── Investigations ──────────────────────────────────────────────────────

export class InvestigationsRepo {
  constructor(private L: Ledger) {}
  create(question: string): UUID {
    const id = newID()
    this.L.db.prepare(`INSERT INTO investigations (id,question,synthesis,created_at,finished_at) VALUES (?,?,?,?,?)`)
      .run(id, question, null, nowMs(), null)
    return id
  }
  addStep(investigationID: UUID, ordinal: number, question: string, answerBody: string | null, conf: number | null, citations: UUID[]): void {
    this.L.db.prepare(
      `INSERT INTO investigation_steps (id,investigation_id,ordinal,question,answer_body,answer_confidence,answer_citations_json,created_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(newID(), investigationID, ordinal, question, answerBody, conf, j(citations), nowMs())
  }
  finish(id: UUID, synthesis: string): void {
    this.L.db.prepare(`UPDATE investigations SET synthesis=?, finished_at=? WHERE id=?`).run(synthesis, nowMs(), id)
  }
  get(id: UUID): any {
    const r = this.L.db.prepare(`SELECT * FROM investigations WHERE id=?`).get(id) as any
    if (!r) return null
    const steps = (this.L.db.prepare(`SELECT * FROM investigation_steps WHERE investigation_id=? ORDER BY ordinal`).all(id) as any[])
      .map((s) => ({ id: s.id, ordinal: Number(s.ordinal), question: s.question, answerBody: s.answer_body ?? null,
        answerConfidence: s.answer_confidence != null ? Number(s.answer_confidence) : null,
        answerCitations: pj(s.answer_citations_json, []), createdAt: Number(s.created_at) }))
    return { id: r.id, question: r.question, synthesis: r.synthesis ?? null, createdAt: Number(r.created_at),
      finishedAt: r.finished_at != null ? Number(r.finished_at) : null, steps }
  }
  list(): any[] {
    return (this.L.db.prepare(`SELECT id FROM investigations ORDER BY created_at DESC`).all() as any[]).map((r) => this.get(r.id))
  }
  remove(id: UUID): void { this.L.db.prepare(`DELETE FROM investigations WHERE id=?`).run(id) }
}

// ── Assertions ──────────────────────────────────────────────────────────

export class AssertionsRepo {
  constructor(private L: Ledger) {}
  add(a: Omit<Assertion, 'id' | 'recordedAt' | 'retractedAt'>): Assertion {
    const id = newID(); const now = nowMs()
    this.L.db.prepare(
      `INSERT INTO assertions (id,subject_kind,subject_id,predicate,object_kind,object_value,object_entity_id,object_event_id,confidence,evidence_object_ids_json,agent,reason,recorded_at,retracted_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(id, a.subjectKind, a.subjectID, a.predicate, a.objectKind, a.objectValue ?? null,
      a.objectEntityID ?? null, a.objectEventID ?? null, a.confidence, j(a.evidenceObjectIDs ?? []),
      a.agent, a.reason ?? null, now, null)
    return { ...a, id, recordedAt: now, retractedAt: null }
  }
  list(subjectID?: UUID): Assertion[] {
    const rows = subjectID
      ? this.L.db.prepare(`SELECT * FROM assertions WHERE subject_id=? AND retracted_at IS NULL ORDER BY recorded_at DESC`).all(subjectID)
      : this.L.db.prepare(`SELECT * FROM assertions WHERE retracted_at IS NULL ORDER BY recorded_at DESC LIMIT 300`).all()
    return (rows as any[]).map(mapAssertion)
  }
  retract(id: UUID): void { this.L.db.prepare(`UPDATE assertions SET retracted_at=? WHERE id=?`).run(nowMs(), id) }
  count(): number {
    return Number((this.L.db.prepare(`SELECT COUNT(*) c FROM assertions WHERE retracted_at IS NULL`).get() as any).c)
  }
}
function mapAssertion(r: any): Assertion {
  return { id: r.id, subjectKind: r.subject_kind, subjectID: r.subject_id, predicate: r.predicate,
    objectKind: r.object_kind, objectValue: r.object_value ?? null, objectEntityID: r.object_entity_id ?? null,
    objectEventID: r.object_event_id ?? null, confidence: Number(r.confidence),
    evidenceObjectIDs: pj(r.evidence_object_ids_json, []), agent: r.agent, reason: r.reason ?? null,
    recordedAt: Number(r.recorded_at), retractedAt: r.retracted_at != null ? Number(r.retracted_at) : null }
}

// ── Event links ─────────────────────────────────────────────────────────

export class EventLinksRepo {
  constructor(private L: Ledger) {}
  insert(link: Omit<EventLink, 'id' | 'createdAt'>): void {
    this.L.db.prepare(
      `INSERT INTO event_links (id,source_event_id,target_event_id,relation,confidence,evidence_object_ids_json,allen,source,reason,created_at,superseded_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(newID(), link.sourceEventID, link.targetEventID, link.relation, link.confidence,
      j(link.evidenceObjectIDs ?? []), link.allen ?? null, link.source, link.reason ?? null, nowMs(), link.supersededBy ?? null)
  }
  forEvent(eventID: UUID): EventLink[] {
    return (this.L.db.prepare(
      `SELECT * FROM event_links WHERE (source_event_id=? OR target_event_id=?) AND superseded_by IS NULL`
    ).all(eventID, eventID) as any[]).map((r) => ({
      id: r.id, sourceEventID: r.source_event_id, targetEventID: r.target_event_id, relation: r.relation,
      confidence: Number(r.confidence), evidenceObjectIDs: pj(r.evidence_object_ids_json, []),
      allen: r.allen ?? null, source: r.source, reason: r.reason ?? null, createdAt: Number(r.created_at),
      supersededBy: r.superseded_by ?? null
    }))
  }
}

// ── Evidence blocks (v28) ───────────────────────────────────────────────

export class BlocksRepo {
  constructor(private L: Ledger) {}
  insertMany(blocks: EvidenceBlock[]): void {
    const stmt = this.L.db.prepare(
      `INSERT INTO evidence_blocks (id,object_id,ordinal,block_type,text,structured_json,page,sheet,row_num,char_start,char_end,section_path_json,citation,extraction_method,extraction_confidence,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    const tx = this.L.db.transaction((rows: EvidenceBlock[]) => {
      for (const b of rows) {
        stmt.run(b.id, b.objectID, b.ordinal, b.blockType, b.text ?? null, j(b.structuredData ?? {}),
          b.page ?? null, b.sheet ?? null, b.rowNum ?? null, b.charStart ?? null, b.charEnd ?? null,
          j(b.sectionPath ?? []), b.citation, b.extractionMethod, b.extractionConfidence, b.createdAt)
      }
    })
    tx(blocks)
  }
  byObject(objectID: UUID): EvidenceBlock[] {
    return (this.L.db.prepare(`SELECT * FROM evidence_blocks WHERE object_id=? ORDER BY ordinal`).all(objectID) as any[]).map(mapBlock)
  }
  byIDs(ids: UUID[]): EvidenceBlock[] {
    if (!ids.length) return []
    const q = ids.map(() => '?').join(',')
    return (this.L.db.prepare(`SELECT * FROM evidence_blocks WHERE id IN (${q})`).all(...ids) as any[]).map(mapBlock)
  }
  count(): number {
    return Number((this.L.db.prepare(`SELECT COUNT(*) c FROM evidence_blocks`).get() as any).c)
  }
}

function mapBlock(r: any): EvidenceBlock {
  return {
    id: r.id, objectID: r.object_id, ordinal: Number(r.ordinal),
    blockType: r.block_type as BlockType, text: r.text ?? null,
    structuredData: pj(r.structured_json, {}), page: r.page != null ? Number(r.page) : null,
    sheet: r.sheet ?? null, rowNum: r.row_num != null ? Number(r.row_num) : null,
    charStart: r.char_start != null ? Number(r.char_start) : null,
    charEnd: r.char_end != null ? Number(r.char_end) : null,
    sectionPath: pj(r.section_path_json, []), citation: r.citation,
    extractionMethod: r.extraction_method as ExtractionMethod,
    extractionConfidence: Number(r.extraction_confidence), createdAt: Number(r.created_at)
  }
}

// ── Claims ledger (v29) ─────────────────────────────────────────────────

export class ClaimsRepo {
  constructor(private L: Ledger) {}
  insertMany(claims: Omit<LedgerClaim, 'id' | 'createdAt'>[]): number {
    const stmt = this.L.db.prepare(
      `INSERT INTO claims (id,claim_text,claim_type,asserted_by,source_object_id,evidence_block_ids_json,confidence,extraction_method,created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    const tx = this.L.db.transaction((rows: Omit<LedgerClaim, 'id' | 'createdAt'>[]) => {
      for (const c of rows) {
        stmt.run(newID(), c.claimText, c.claimType, c.assertedBy ?? null, c.sourceObjectID,
          j(c.evidenceBlockIDs ?? []), c.confidence, c.extractionMethod, nowMs())
      }
    })
    tx(claims)
    return claims.length
  }
  list(objectID?: UUID, limit = 300): LedgerClaim[] {
    const rows = objectID
      ? this.L.db.prepare(`SELECT * FROM claims WHERE source_object_id=? ORDER BY created_at DESC LIMIT ?`).all(objectID, limit)
      : this.L.db.prepare(`SELECT * FROM claims ORDER BY created_at DESC LIMIT ?`).all(limit)
    return (rows as any[]).map(mapLedgerClaim)
  }
  byType(type: ClaimType, limit = 500): LedgerClaim[] {
    return (this.L.db.prepare(`SELECT * FROM claims WHERE claim_type=? LIMIT ?`).all(type, limit) as any[]).map(mapLedgerClaim)
  }
  ftsSearch(query: string, limit = 20): LedgerClaim[] {
    const match = toFtsMatch(query, 'or')
    if (!match) return []
    try {
      const rows = this.L.db.prepare(
        `SELECT c.* FROM claims_fts JOIN claims c ON c.rowid = claims_fts.rowid
         WHERE claims_fts MATCH ? ORDER BY bm25(claims_fts) LIMIT ?`
      ).all(match, limit) as any[]
      return rows.map(mapLedgerClaim)
    } catch { return [] }
  }
  count(): number {
    return Number((this.L.db.prepare(`SELECT COUNT(*) c FROM claims`).get() as any).c)
  }
}

function mapLedgerClaim(r: any): LedgerClaim {
  return {
    id: r.id, claimText: r.claim_text, claimType: r.claim_type as ClaimType,
    assertedBy: r.asserted_by ?? null, sourceObjectID: r.source_object_id,
    evidenceBlockIDs: pj(r.evidence_block_ids_json, []), confidence: Number(r.confidence),
    extractionMethod: r.extraction_method, createdAt: Number(r.created_at)
  }
}

// ── Contradiction ledger (v30) ──────────────────────────────────────────

export class ContradictionsRepo {
  constructor(private L: Ledger) {}
  upsert(c: Omit<LedgerContradiction, 'id' | 'detectedAt'>): void {
    this.L.db.prepare(
      `INSERT INTO contradictions (id,kind,a_kind,a_id,b_kind,b_id,explanation,resolution_status,detected_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(a_id,b_id,kind) DO UPDATE SET explanation=excluded.explanation`
    ).run(newID(), c.kind, c.aKind, c.aID, c.bKind, c.bID, c.explanation, c.resolutionStatus ?? 'unresolved', nowMs())
  }
  list(limit = 200): LedgerContradiction[] {
    return (this.L.db.prepare(`SELECT * FROM contradictions ORDER BY detected_at DESC LIMIT ?`).all(limit) as any[]).map(mapContra)
  }
  byID(id: UUID): LedgerContradiction | null {
    const r = this.L.db.prepare(`SELECT * FROM contradictions WHERE id=?`).get(id) as any
    return r ? mapContra(r) : null
  }
  forItem(id: UUID): LedgerContradiction[] {
    return (this.L.db.prepare(`SELECT * FROM contradictions WHERE a_id=? OR b_id=?`).all(id, id) as any[]).map(mapContra)
  }
  count(): number {
    return Number((this.L.db.prepare(`SELECT COUNT(*) c FROM contradictions WHERE resolution_status='unresolved'`).get() as any).c)
  }
}

function mapContra(r: any): LedgerContradiction {
  return {
    id: r.id, kind: r.kind, aKind: r.a_kind, aID: r.a_id, bKind: r.b_kind, bID: r.b_id,
    explanation: r.explanation, resolutionStatus: r.resolution_status, detectedAt: Number(r.detected_at)
  }
}

// ── Ingestion runs (v28) ────────────────────────────────────────────────

export class IngestionRunsRepo {
  constructor(private L: Ledger) {}
  start(fileID: UUID, parser: string): UUID {
    const id = newID()
    this.L.db.prepare(`INSERT INTO ingestion_runs (id,file_id,parser,status,started_at) VALUES (?,?,?,?,?)`)
      .run(id, fileID, parser, 'parsing', nowMs())
    return id
  }
  finish(id: UUID, patch: { status: IngestionRun['status']; blocks?: number; chunks?: number; tableRows?: number; claims?: number; embeddings?: number; warnings?: string[] }): void {
    this.L.db.prepare(
      `UPDATE ingestion_runs SET status=?, blocks=?, chunks=?, table_rows=?, claims=?, embeddings=?, warnings_json=?, finished_at=? WHERE id=?`
    ).run(patch.status, patch.blocks ?? 0, patch.chunks ?? 0, patch.tableRows ?? 0,
      patch.claims ?? 0, patch.embeddings ?? 0, j(patch.warnings ?? []), nowMs(), id)
  }
  list(limit = 100): IngestionRun[] {
    return (this.L.db.prepare(`SELECT * FROM ingestion_runs ORDER BY started_at DESC LIMIT ?`).all(limit) as any[]).map((r) => ({
      id: r.id, fileID: r.file_id, parser: r.parser, status: r.status,
      blocks: Number(r.blocks), chunks: Number(r.chunks), tableRows: Number(r.table_rows),
      claims: Number(r.claims), embeddings: Number(r.embeddings), warnings: pj(r.warnings_json, []),
      startedAt: Number(r.started_at), finishedAt: r.finished_at != null ? Number(r.finished_at) : null
    }))
  }
}

// ── Structured table rows (v31) ─────────────────────────────────────────

export class TableRowsRepo {
  constructor(private L: Ledger) {}
  insertMany(rows: Omit<TableRow, 'id' | 'createdAt'>[]): number {
    const stmt = this.L.db.prepare(
      `INSERT INTO table_rows (id,object_id,sheet,row_num,columns_json,created_at) VALUES (?,?,?,?,?,?)`
    )
    const tx = this.L.db.transaction((rs: Omit<TableRow, 'id' | 'createdAt'>[]) => {
      for (const r of rs) stmt.run(newID(), r.objectID, r.sheet ?? null, r.rowNum, j(r.columns), nowMs())
    })
    tx(rows)
    return rows.length
  }
  byObject(objectID: UUID, limit = 1000): TableRow[] {
    return (this.L.db.prepare(`SELECT * FROM table_rows WHERE object_id=? ORDER BY row_num LIMIT ?`).all(objectID, limit) as any[])
      .map((r) => ({ id: r.id, objectID: r.object_id, sheet: r.sheet ?? null, rowNum: Number(r.row_num), columns: pj(r.columns_json, {}), createdAt: Number(r.created_at) }))
  }
  count(): number {
    return Number((this.L.db.prepare(`SELECT COUNT(*) c FROM table_rows`).get() as any).c)
  }
}

// ── Review ledger (v32, append-only) ────────────────────────────────────

export class ReviewsRepo {
  constructor(private L: Ledger) {}
  add(r: { targetKind: string; targetID: UUID; action: string; priorValue?: string | null; newValue?: string | null; reason?: string | null; reviewer?: string }): void {
    this.L.db.prepare(
      `INSERT INTO reviews (id,target_kind,target_id,action,prior_value,new_value,reason,reviewer,created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(newID(), r.targetKind, r.targetID, r.action, r.priorValue ?? null, r.newValue ?? null,
      r.reason ?? null, r.reviewer ?? 'user', nowMs())
  }
  forTarget(targetID: UUID): { action: string; priorValue: string | null; newValue: string | null; createdAt: number }[] {
    return (this.L.db.prepare(`SELECT * FROM reviews WHERE target_id=? ORDER BY created_at`).all(targetID) as any[])
      .map((r) => ({ action: r.action, priorValue: r.prior_value ?? null, newValue: r.new_value ?? null, createdAt: Number(r.created_at) }))
  }
  count(): number {
    return Number((this.L.db.prepare(`SELECT COUNT(*) c FROM reviews`).get() as any).c)
  }
}

// ── Answer audit ledger (v32, append-only) ──────────────────────────────

export class AnswerAuditsRepo {
  constructor(private L: Ledger) {}
  add(a: { question: string; intentKind?: string | null; classification?: string | null; answerBody: string;
           citations: unknown[]; contradictions: number; gaps: string[]; confidence: number;
           source?: string | null; llmPurposes: string[] }): void {
    this.L.db.prepare(
      `INSERT INTO answer_audits (id,question,intent_kind,classification,answer_body,citations_json,contradictions,gaps_json,confidence,source,llm_purposes_json,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(newID(), a.question, a.intentKind ?? null, a.classification ?? null, a.answerBody,
      j(a.citations), a.contradictions, j(a.gaps), a.confidence, a.source ?? null, j(a.llmPurposes), nowMs())
  }
  count(): number {
    return Number((this.L.db.prepare(`SELECT COUNT(*) c FROM answer_audits`).get() as any).c)
  }
}
