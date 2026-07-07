//
// timelineComposer.ts — rule-based history reconstruction. For reconstructive
// intents the LEDGER composes the narrative: events are sorted, deduped, and
// grouped into periods deterministically, so the facts cannot be hallucinated.
// The LLM's only job is optional language polish, and the polish is
// fact-locked: if it introduces a single number or date that isn't in the
// skeleton, we throw the polish away and ship the skeleton.
//
// This is the answer to "the AI uses its trained knowledge": for history
// questions the model never sources facts — the database does.
//

import type { RetrievalResult, CapabilitySpec } from '../../shared/ai'
import type { KEvent, UUID } from '../../shared/models'
// KEvent now carries epistemicStatus + corroborationCount (Fact Status Matrix).
import type { CapabilityRegistry } from '../routing/capabilityRegistry'
import { log } from '../core/logger'

const POLISH_SPEC: CapabilitySpec = {
  requires: ['textGeneration', 'summarization'],
  prefers: ['reasoning'],
  maxLatency: 'background', privacy: 'localNetwork',
  estimatedContextTokens: 4000, purpose: 'history.polish'
}

export interface ComposedHistory {
  prose: string
  eventIDs: UUID[]
  objectIDs: UUID[]
}

export async function composeHistory(
  retrieval: RetrievalResult,
  capabilities: CapabilityRegistry
): Promise<ComposedHistory | null> {
  // 1. Order and dedupe the ledger's events (highest date-confidence wins).
  const byKey = new Map<string, KEvent>()
  for (const e of retrieval.events) {
    const key = (e.title || '').toLowerCase().replace(/\s+/g, ' ').trim() || e.id
    const prev = byKey.get(key)
    if (!prev || e.dateConfidence > prev.dateConfidence) byKey.set(key, e)
  }
  const events = [...byKey.values()].sort((a, b) => a.date - b.date)
  if (events.length < 2) return null

  // 2. Deterministic skeleton: period-grouped, dated, full sentences.
  const byMonth = new Map<string, KEvent[]>()
  for (const e of events) {
    const m = new Date(e.date).toISOString().slice(0, 7)
    const arr = byMonth.get(m) ?? []
    arr.push(e)
    byMonth.set(m, arr)
  }
  const first = new Date(events[0].date).toISOString().slice(0, 10)
  const last = new Date(events[events.length - 1].date).toISOString().slice(0, 10)
  const sections: string[] = []
  for (const [month, evs] of byMonth) {
    const lines = evs.map((e) => {
      const when = new Date(e.date).toISOString().slice(0, 10)
      const what = (e.title || e.summary || 'an event was recorded').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '')
      const startsTemporal = /^(on|in|by|between|during|as of|since|from)\b/i.test(what)
      const sentence = startsTemporal ? `${what[0].toUpperCase()}${what.slice(1)}.` : `On ${when}, ${what[0] ? what[0].toLowerCase() + what.slice(1) : what}.`
      // Fact Status Matrix tag: every line declares HOW it is known.
      return `${sentence} ${statusTag(e)}`
    })
    sections.push(`${monthLabel(month)}\n${lines.join('\n')}`)
  }
  const skeleton =
    `Reconstructed from ${events.length} dated events in your sources (${first} → ${last}):\n\n` +
    sections.join('\n\n')

  // 3. Optional LLM polish — language only, facts locked.
  const polished = await capabilities.tryGenerate(
    POLISH_SPEC,
    `Rewrite the following dated event log as a flowing, readable historical narrative in short paragraphs, ` +
      `keeping chronological order.\nHARD RULES:\n` +
      `1. Use ONLY the facts below. Do not add ANY fact, name, organization, date, number, or interpretation that is not written below.\n` +
      `2. Keep every date exactly as written.\n` +
      `3. Keep each bracketed status tag like [observed] or [inferred] attached to its fact.\n` +
      `4. Do not speculate about causes or motives unless the text states them.\n\n` +
      `EVENT LOG:\n${skeleton}\n\nNARRATIVE:`,
    { maxTokens: 1100, temperature: 0.2 }
  )

  let prose = skeleton
  if (polished?.trim()) {
    if (polishIsFactLocked(polished, skeleton)) {
      prose = polished.trim()
    } else {
      log.brain('history polish rejected — introduced facts not in the ledger skeleton')
    }
  }

  return {
    prose,
    eventIDs: events.map((e) => e.id),
    objectIDs: [...new Set(events.map((e) => e.sourceObjectID))]
  }
}

/** Every number/date token in the polish must already exist in the skeleton. */
function polishIsFactLocked(polish: string, skeleton: string): boolean {
  const skNums = new Set(numTokens(skeleton))
  return numTokens(polish).every((n) => skNums.has(n))
}

function numTokens(s: string): string[] {
  return (s.match(/\d[\d,./-]*\d|\d/g) ?? []).map((n) => n.replace(/[,\s]/g, '').replace(/[./-]+$/, ''))
}

/** "[observed · 2 sources]" — the per-line epistemic label. */
function statusTag(e: KEvent): string {
  const src = e.corroborationCount >= 2 ? ` · ${e.corroborationCount} sources` : ''
  return `[${e.epistemicStatus}${src}]`
}

function monthLabel(isoMonth: string): string {
  const [y, m] = isoMonth.split('-').map(Number)
  const names = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']
  return `${names[(m ?? 1) - 1]} ${y}`
}
