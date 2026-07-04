//
// memoryDistiller.ts — the Knowledge Memory layer. Ported from Knowledge/
// Memory/MemoryDistiller.swift. One MemoryObject per subject holds the
// distilled state so the brain answers without re-reading every document.
// This is the "memory cache" first hop in the retrieval priority order.
//

import type { Repos } from '../storage'
import type { Summarizer } from './summarizer'
import type { UUID, SubjectKind, EntityKind } from '../../shared/models'
import { log } from '../core/logger'

const KIND_TO_SUBJECT: Partial<Record<EntityKind, SubjectKind>> = {
  organization: 'organization', vendor: 'organization', client: 'organization',
  person: 'person', project: 'project', deliverable: 'deliverable'
}

export class MemoryDistiller {
  constructor(private repos: Repos, private summarizer: Summarizer) {}

  async distillEntity(entityID: UUID): Promise<void> {
    const entity = this.repos.entities.byID(entityID)
    if (!entity) return
    const subjectKind = KIND_TO_SUBJECT[entity.kind] ?? 'topic'
    const events = this.repos.events.forEntity(entityID, 60)
    if (!events.length) return
    const rels = this.repos.relationships.forEntity(entityID, 40)
    const sourceObjectIDs = [...new Set(events.map((e) => e.sourceObjectID))].slice(0, 40)

    const bullets = events
      .slice(0, 20)
      .map((e) => `- ${new Date(e.date).toISOString().slice(0, 10)}: ${e.title}`)
      .join('\n')
    const narrative = await this.summarizer.summarize(
      `Everything known about "${entity.value}":\n${bullets}`,
      { title: entity.value, maxSentences: 4 }
    )

    this.repos.memory.upsert({
      subjectKind, subjectIdentifier: entity.normalizedValue ?? entity.value.toLowerCase(),
      narrative, keyEventIDs: events.slice(0, 20).map((e) => e.id),
      sourceObjectIDs, confidence: Math.min(0.9, 0.4 + events.length * 0.03),
      qualityTier: entity.qualityTier
    })
    log.knowledge(`distilled memory for "${entity.value}" (${events.length} events)`)
  }

  /** Post-ingest pass: distill the most-mentioned entities. */
  async distillTop(limit = 12): Promise<number> {
    const top = this.repos.entities
      .list(undefined, 200)
      .filter((e) => ['organization', 'person', 'project', 'client', 'vendor'].includes(e.kind))
      .slice(0, limit)
    let n = 0
    for (const e of top) {
      try {
        await this.distillEntity(e.id)
        n++
      } catch (err) {
        log.knowledge.warn(`distill failed for ${e.value}: ${String(err)}`)
      }
    }
    return n
  }
}
