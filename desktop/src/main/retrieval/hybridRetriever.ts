//
// hybridRetriever.ts — the retrieval surface for the brain + experts. Ported
// from Retrieval/HybridRetriever.swift. The locked priority order is baked in
// here: Memory → Timeline → Entity → FTS/metadata → Summary → Graph → Vector.
// Structure answers first; similarity is the LAST resort, not the first.
//

import type { Repos } from '../storage'
import type { CapabilityRegistry } from '../routing/capabilityRegistry'
import type {
  UserIntent, RetrievalLayer, RetrievalResult, RetrievedChunk
} from '../../shared/ai'
import { emptyRetrieval } from '../../shared/ai'
import type { Entity, KEvent, Relationship, Summary, Chunk, UUID } from '../../shared/models'
import { log } from '../core/logger'

const RRF_K = 60

const QUERY_STOP = new Set([
  'the', 'and', 'was', 'were', 'what', 'when', 'who', 'which', 'how', 'why',
  'where', 'did', 'does', 'have', 'has', 'had', 'that', 'this', 'with', 'from',
  'for', 'are', 'about', 'tell', 'give', 'show', 'happened', 'between', 'their',
  'them', 'they', 'there', 'will', 'would', 'could', 'should'
])

function contentWords(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[a-z][a-z0-9&.-]{3,}/g) ?? [])
    .filter((w) => !QUERY_STOP.has(w)))]
}

export class HybridRetriever {
  constructor(private repos: Repos, private capabilities: CapabilityRegistry) {}

  async retrieve(intent: UserIntent, layers: RetrievalLayer[]): Promise<RetrievalResult> {
    const question = intent.rawQuestion
    const layersUsed: RetrievalLayer[] = []
    const entities = new Map<UUID, Entity>()
    const events = new Map<UUID, KEvent>()
    const relationships = new Map<UUID, Relationship>()
    const summaries = new Map<UUID, Summary>()

    // Resolve entity hints once — several layers key off them.
    const hinted: Entity[] = []
    for (const hint of intent.entityHints) {
      for (const e of this.repos.entities.search(hint, 3)) {
        if (!entities.has(e.id)) { entities.set(e.id, e); hinted.push(e) }
      }
    }
    // Recall: also match EVERY content word of the question against the entity
    // table — capitalized-hint detection misses lowercase mentions ("acme"),
    // and thin evidence is exactly when the LLM leaks trained knowledge.
    for (const w of contentWords(question).slice(0, 10)) {
      for (const e of this.repos.entities.search(w, 2)) {
        if (!entities.has(e.id)) { entities.set(e.id, e); hinted.push(e) }
      }
    }

    // ── Timeline ──────────────────────────────────────────────────────
    if (layers.includes('timeline')) {
      layersUsed.push('timeline')
      const tf = intent.timeframe
      const base = hinted.length
        ? hinted.flatMap((e) => this.repos.events.forEntity(e.id, 40))
        : this.repos.events.inRange(tf?.start, tf?.end, 60)
      for (const ev of base) {
        if (tf && (tf.start && ev.date < tf.start || tf.end && ev.date > tf.end)) continue
        events.set(ev.id, ev)
      }
    }

    // ── Entity ────────────────────────────────────────────────────────
    if (layers.includes('entity')) {
      layersUsed.push('entity')
      for (const e of hinted) {
        for (const ev of this.repos.events.forEntity(e.id, 30)) events.set(ev.id, ev)
        for (const r of this.repos.relationships.forEntity(e.id, 20)) relationships.set(r.id, r)
      }
    }

    // ── FTS (metadata) + Vector fused via RRF ─────────────────────────
    // Precision→recall ladder: strict AND first (all content terms in one
    // chunk), OR fallback when that under-delivers.
    let ftsRanks: { chunkID: UUID; rank: number }[] = []
    if (layers.includes('metadata')) {
      layersUsed.push('metadata')
      ftsRanks = this.repos.chunks.ftsSearch(question, 40, 'and')
      if (ftsRanks.length < 3) {
        const orRanks = this.repos.chunks.ftsSearch(question, 40, 'or')
        const seen = new Set(ftsRanks.map((r) => r.chunkID))
        ftsRanks = [...ftsRanks, ...orRanks.filter((r) => !seen.has(r.chunkID))]
      }
    }

    let vecRanks: { chunkID: UUID; score: number }[] = []
    if (layers.includes('vector')) {
      layersUsed.push('vector')
      const qvec = await this.capabilities.embed(question)
      if (qvec) vecRanks = this.repos.vectors.nearest(qvec, 40)
    }

    const fused = this.rrf(ftsRanks, vecRanks)
    const chunkIDs = fused.map((f) => f.chunkID)
    const chunkMap = new Map(this.repos.chunks.byIDs(chunkIDs).map((c) => [c.id, c]))
    const chunks: RetrievedChunk[] = []
    for (const f of fused) {
      const c = chunkMap.get(f.chunkID)
      if (c) chunks.push({ chunk: c, score: f.score, viaLayer: f.via })
    }
    // Dynamic context expansion: small atomic chunks at ingest, wider context
    // at query time. For the top hits, pull the previous/next chunk of the
    // same document so a retrieved clause arrives with its surroundings
    // ("If cancellation occurs within 7 days, " + "the penalty is waived.").
    {
      const have = new Set(chunks.map((rc) => rc.chunk.id))
      for (const top of chunks.slice(0, 5)) {
        const siblings = this.repos.chunks.byObject(top.chunk.objectID)
        for (const delta of [-1, 1]) {
          const n = siblings.find((c) => c.ordinal === top.chunk.ordinal + delta)
          if (n && !have.has(n.id)) {
            have.add(n.id)
            chunks.push({ chunk: n, score: top.score * 0.5, viaLayer: top.viaLayer })
          }
        }
      }
    }
    // Backfill: when text evidence is thin but structured events matched, pull
    // the chunks of the events' source documents so the synthesizer always has
    // the surrounding text — not just one-line event titles.
    if (chunks.length < 5 && events.size > 0) {
      const have = new Set(chunks.map((rc) => rc.chunk.id))
      const objIDs = [...new Set([...events.values()].slice(0, 4).map((e) => e.sourceObjectID))]
      for (const oid of objIDs) {
        for (const c of this.repos.chunks.byObject(oid).slice(0, 3)) {
          if (!have.has(c.id)) { have.add(c.id); chunks.push({ chunk: c, score: 0.01, viaLayer: 'entity' }) }
        }
      }
    }

    // ── Summary ───────────────────────────────────────────────────────
    if (layers.includes('summary')) {
      layersUsed.push('summary')
      const terms = new Set((question.toLowerCase().match(/[a-z]{4,}/g) ?? []))
      for (const s of this.repos.summaries.list(undefined, 50)) {
        const body = s.body.toLowerCase()
        if ([...terms].some((t) => body.includes(t))) summaries.set(s.id, s)
      }
    }

    // ── Graph ─────────────────────────────────────────────────────────
    if (layers.includes('graph')) {
      layersUsed.push('graph')
      for (const e of hinted) {
        for (const r of this.repos.relationships.forEntity(e.id, 20)) {
          relationships.set(r.id, r)
          const other = r.fromEntityID === e.id ? r.toEntityID : r.fromEntityID
          const oe = this.repos.entities.byID(other)
          if (oe && !entities.has(oe.id)) entities.set(oe.id, oe)
        }
      }
    }

    // Backfill entities referenced by retrieved events so citations resolve.
    for (const ev of events.values()) {
      for (const eid of this.repos.events.entitiesFor(ev.id)) {
        if (!entities.has(eid)) {
          const e = this.repos.entities.byID(eid)
          if (e) entities.set(eid, e)
        }
      }
    }

    const result: RetrievalResult = {
      ...emptyRetrieval(),
      chunks: chunks.slice(0, 30),
      events: [...events.values()].sort((a, b) => b.date - a.date).slice(0, 60),
      entities: [...entities.values()].slice(0, 40),
      relationships: [...relationships.values()].slice(0, 40),
      summaries: [...summaries.values()].slice(0, 10),
      layersUsed
    }
    log.retrieval(`retrieve "${question.slice(0, 40)}": ${result.chunks.length} chunks, ${result.events.length} events, ${result.entities.length} entities`)
    return result
  }

  private rrf(
    fts: { chunkID: UUID; rank: number }[],
    vec: { chunkID: UUID; score: number }[]
  ): { chunkID: UUID; score: number; via: RetrievalLayer }[] {
    const scores = new Map<UUID, { score: number; via: RetrievalLayer }>()
    fts.forEach((f, i) => {
      const cur = scores.get(f.chunkID) ?? { score: 0, via: 'metadata' as RetrievalLayer }
      cur.score += 1 / (RRF_K + i + 1)
      scores.set(f.chunkID, cur)
    })
    vec.forEach((v, i) => {
      const cur = scores.get(v.chunkID) ?? { score: 0, via: 'vector' as RetrievalLayer }
      cur.score += 1 / (RRF_K + i + 1)
      if (!scores.has(v.chunkID)) cur.via = 'vector'
      scores.set(v.chunkID, cur)
    })
    return [...scores.entries()]
      .map(([chunkID, v]) => ({ chunkID, score: v.score, via: v.via }))
      .sort((a, b) => b.score - a.score)
  }
}
