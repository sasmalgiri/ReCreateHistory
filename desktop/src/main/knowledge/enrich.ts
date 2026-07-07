//
// enrich.ts — orchestrates the noun+verb+edge extraction for a single
// KnowledgeObject and writes the results into the ledger. This is the heart
// of "the intelligence lives in the database": after ingest, everything
// downstream reads structured entities/events/relationships, never raw files.
//

import type { Repos } from '../storage'
import type { UUID } from '../../shared/models'
import { extractEntities } from './entityExtractor'
import { extractEvents } from './eventExtractor'
import { log } from '../core/logger'

export interface EnrichResult {
  entityIDs: UUID[]
  eventIDs: UUID[]
  entityCount: number
  eventCount: number
  relationshipCount: number
}

export function enrichObject(
  repos: Repos,
  objectID: UUID,
  content: string,
  metadata: Record<string, unknown>,
  fileModifiedAt: number
): EnrichResult {
  const isEmail = metadata.isEmail === true
  const emailHeaders = isEmail
    ? { from: String(metadata.from ?? ''), to: String(metadata.to ?? ''), cc: String(metadata.cc ?? '') }
    : undefined

  // ── Entities ──────────────────────────────────────────────────────────
  const extracted = extractEntities(content, { emailHeaders })
  const idByNorm = new Map<string, UUID>()
  const entityIDs: UUID[] = []
  for (const e of extracted) {
    const id = repos.entities.upsertCanonical({
      kind: e.kind, value: e.value, normalized: e.normalized,
      sourceObjectID: objectID, confidence: e.confidence, qualityTier: e.qualityTier
    })
    repos.entities.addMention(id, e.kind, e.value, e.normalized, objectID, e.confidence)
    idByNorm.set(e.normalized, id)
    if (!entityIDs.includes(id)) entityIDs.push(id)
  }

  // ── Events ────────────────────────────────────────────────────────────
  const eventsExtracted = extractEvents(content, {
    isEmail,
    emailDate: metadata.date as string | undefined,
    emailSubject: metadata.subject as string | undefined,
    emailFrom: metadata.from as string | undefined,
    fileModifiedAt
  })
  const eventIDs: UUID[] = []
  const topEntityIDs = extracted
    .slice()
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 4)
    .map((e) => idByNorm.get(e.normalized))
    .filter((x): x is UUID => !!x)

  for (const ev of eventsExtracted) {
    // Link entities mentioned in the event context, else the KO's top entities.
    const ctx = `${ev.title} ${ev.summary ?? ''}`.toLowerCase()
    const linked = extracted
      .filter((e) => ctx.includes(e.normalized))
      .map((e) => idByNorm.get(e.normalized))
      .filter((x): x is UUID => !!x)
    const participants = linked.length ? linked : topEntityIDs
    const inserted = repos.events.insert({
      kind: ev.kind, date: ev.date, title: ev.title, summary: ev.summary ?? null,
      entityIDs: participants, sourceObjectID: objectID, confidence: ev.confidence,
      dateConfidence: ev.dateConfidence, qualityTier: ev.qualityTier, datePrecision: ev.datePrecision
    })
    eventIDs.push(inserted.id)
  }

  // ── Aliases (ENTITY_ALIAS_OF): "Alice Smith <alice@acme.com>" links the
  // person entity to the address, so either surface resolves the same node.
  if (isEmail) {
    for (const field of ['from', 'to', 'cc']) {
      const raw = String(metadata[field] ?? '')
      for (const m of raw.matchAll(/([A-Za-z][\w.'-]*(?:\s+[A-Za-z][\w.'-]*)+)\s*<([^>]+)>/g)) {
        const name = m[1].trim()
        const email = m[2].trim().toLowerCase()
        const personID = idByNorm.get(name.toLowerCase())
        if (personID && email.includes('@')) {
          repos.entities.addAlias(personID, email, 'email-header')
          const emailID = idByNorm.get(email)
          if (emailID) repos.entities.addAlias(emailID, name.toLowerCase(), 'email-header')
        }
      }
    }
  }

  // ── Relationships ─────────────────────────────────────────────────────
  let relCount = 0
  // Email: from → to  (emailed edge).
  if (isEmail) {
    const fromEmail = firstEmail(String(metadata.from ?? ''))
    const toEmail = firstEmail(String(metadata.to ?? ''))
    const fromID = fromEmail ? idByNorm.get(fromEmail.toLowerCase()) : undefined
    const toID = toEmail ? idByNorm.get(toEmail.toLowerCase()) : undefined
    if (fromID && toID && fromID !== toID) {
      repos.relationships.upsert({ kind: 'emailed', fromEntityID: fromID, toEntityID: toID, sourceObjectID: objectID, confidence: 0.8 })
      relCount++
    }
  }
  // Co-occurrence edges between the KO's top entities (capped to avoid N^2 blowup).
  const capped = entityIDs.slice(0, 8)
  for (let i = 0; i < capped.length; i++) {
    for (let k = i + 1; k < capped.length; k++) {
      const [a, b] = [capped[i], capped[k]].sort()
      repos.relationships.upsert({ kind: 'co_occurs', fromEntityID: a, toEntityID: b, sourceObjectID: objectID, confidence: 0.4 })
      relCount++
    }
  }

  log.knowledge(`enriched KO ${objectID.slice(0, 8)}: ${entityIDs.length} entities, ${eventIDs.length} events, ${relCount} edges`)
  return {
    entityIDs, eventIDs,
    entityCount: entityIDs.length, eventCount: eventIDs.length, relationshipCount: relCount
  }
}

function firstEmail(s: string): string | null {
  return s.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? null
}
