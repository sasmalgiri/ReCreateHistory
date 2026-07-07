//
// factStatus.ts — the Fact Status Matrix engine. Rule-based classification of
// every event's epistemic standing, corroboration counting, persisted
// contradiction detection, and missing-proof analysis. This is the product's
// second killer feature: separating proven facts, inferred events,
// contradictions, and missing evidence — deterministically.
//
//   observed  — from a structured source (email header, log, timestamp)
//   asserted  — stated in body text with a stated date
//   derived   — computed from stated facts (reserved for computed dates)
//   inferred  — indirect (file-mtime fallback, weak date)
//   contradicted — conflicting evidence exists (also a ledger row)
//   unsupported  — nothing backs it (kept, demoted)
//

import type { Repos } from '../storage'
import type { KEvent, EpistemicStatus } from '../../shared/models'
import type { MissingProofItem, FactMatrix } from '../../shared/ipc'
import { log } from '../core/logger'

function normTitle(t: string): string {
  return t.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Grouping key for "same stated fact": the title with date tokens stripped,
 *  so "completed on 2025-05-28" and "completed on 2025-05-30" group together
 *  and their date disagreement becomes a detectable contradiction. */
function factKey(t: string): string {
  return normTitle(t)
    .replace(/\b(19|20)\d{2}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s*(\d{4})?\b/g, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function baseStatus(e: KEvent): { status: EpistemicStatus; reason: string } {
  if (e.qualityTier === 'T1' || e.dateConfidence >= 0.9) {
    return { status: 'observed', reason: 'from a structured source (header/timestamp)' }
  }
  if (e.dateConfidence >= 0.6) {
    return { status: 'asserted', reason: 'stated in document text with an explicit date' }
  }
  if (e.dateConfidence >= 0.45) {
    return { status: 'derived', reason: 'computed from stated facts' }
  }
  return { status: 'inferred', reason: 'indirect evidence only (e.g. file modification time)' }
}

/**
 * Recompute the Fact Status Matrix across the whole ledger. Runs after every
 * ingest batch: base status per event → cross-document corroboration →
 * date-conflict contradictions persisted to the contradiction ledger.
 */
export function recomputeFactStatus(repos: Repos): void {
  const events = repos.events.all(5000)
  if (!events.length) return

  // Group same-fact events across documents by date-stripped fact key, so a
  // fact restated with a DIFFERENT date still lands in the same group.
  const groups = new Map<string, KEvent[]>()
  for (const e of events) {
    const key = factKey(e.title)
    if (!key || key === 'document ingested' || key.length < 12) {
      // mtime fallbacks / degenerate keys are per-document; never corroborate.
      groups.set(`${key}::${e.id}`, [e])
      continue
    }
    const arr = groups.get(key) ?? []
    arr.push(e)
    groups.set(key, arr)
  }

  let contradictions = 0
  for (const group of groups.values()) {
    const sources = new Set(group.map((e) => e.sourceObjectID))
    const corroboration = sources.size

    // A date conflict requires DIFFERENT SOURCES asserting different days for
    // the same fact. One sentence mentioning two dates (issued X, paid Y) in a
    // single document is normal prose, not a contradiction.
    const conflictedIDs = new Set<string>()
    const conflictDays = new Set<string>()
    for (let i = 0; i < group.length; i++) {
      for (let k = i + 1; k < group.length; k++) {
        const a = group[i], b = group[k]
        if (a.sourceObjectID === b.sourceObjectID) continue
        // Compare at the COARSER precision of the pair: "2025" vs "2025-03-14"
        // agree at year level — that is vagueness, not contradiction.
        const grain = Math.min(precisionGrain(a.datePrecision), precisionGrain(b.datePrecision))
        const dA = dateAtGrain(a.date, grain)
        const dB = dateAtGrain(b.date, grain)
        if (dA === dB) continue
        conflictedIDs.add(a.id); conflictedIDs.add(b.id)
        conflictDays.add(dA); conflictDays.add(dB)
        repos.contradictions.upsert({
          kind: 'date_conflict',
          aKind: 'event', aID: a.id,
          bKind: 'event', bID: b.id,
          explanation: `"${a.title.slice(0, 120)}" is dated ${dA} in one source, but another source dates it ${dB}.`,
          resolutionStatus: 'unresolved'
        })
        contradictions++
      }
    }

    for (const e of group) {
      const base = baseStatus(e)
      const isConflicted = conflictedIDs.has(e.id)
      const status: EpistemicStatus = isConflicted ? 'contradicted' : base.status
      const reason = isConflicted
        ? `conflicting dates across sources (${[...conflictDays].join(' vs ')})`
        : corroboration >= 2
          ? `${base.reason}; corroborated by ${corroboration} sources`
          : base.reason
      repos.events.setFactStatus(e.id, status, corroboration, reason)
    }
  }
  log.knowledge(`fact status recomputed: ${events.length} events, ${contradictions} contradiction(s) persisted`)
}

/** Map DatePrecision (Wikidata-style int) to comparison grain: 0=year, 1=month, 2=day. */
function precisionGrain(p: number): number {
  if (p <= 9) return 0
  if (p === 10) return 1
  return 2
}

function dateAtGrain(ms: number, grain: number): string {
  const iso = new Date(ms).toISOString()
  return grain === 0 ? iso.slice(0, 4) : grain === 1 ? iso.slice(0, 7) : iso.slice(0, 10)
}

/** Rule-based missing-proof analysis — what the sources do NOT establish. */
export function missingProof(repos: Repos): MissingProofItem[] {
  const out: MissingProofItem[] = []
  const events = repos.events.all(3000)

  // 1. Single-source, low-confidence events.
  for (const e of events) {
    if (e.corroborationCount <= 1 && e.epistemicStatus === 'inferred') {
      out.push({
        kind: 'single_source',
        description: `"${e.title.slice(0, 110)}" rests on a single indirect source — no corroboration found.`,
        relatedEventID: e.id, relatedClaimID: null, severity: 'warn'
      })
    } else if (e.dateConfidence < 0.5 && e.epistemicStatus !== 'observed') {
      out.push({
        kind: 'low_confidence_date',
        description: `The date of "${e.title.slice(0, 110)}" is uncertain (confidence ${Math.round(e.dateConfidence * 100)}%).`,
        relatedEventID: e.id, relatedClaimID: null, severity: 'info'
      })
    }
    if (out.length >= 30) break
  }

  // 2. Unfulfilled obligations: an invoiceIssued with no later invoicePaid.
  const issued = events.filter((e) => e.kind === 'invoiceIssued')
  const paid = events.filter((e) => e.kind === 'invoicePaid')
  for (const inv of issued) {
    const settled = paid.some((p) => p.date >= inv.date)
    if (!settled) {
      out.push({
        kind: 'unfulfilled_obligation',
        description: `Invoice event "${inv.title.slice(0, 100)}" has no payment evidence after ${new Date(inv.date).toISOString().slice(0, 10)}.`,
        relatedEventID: inv.id, relatedClaimID: null, severity: 'warn'
      })
    }
  }

  // 3. Timeline gaps: months with zero events inside the covered span.
  const dated = events.filter((e) => normTitle(e.title) !== 'document ingested').sort((a, b) => a.date - b.date)
  if (dated.length >= 4) {
    const monthsWith = new Set(dated.map((e) => new Date(e.date).toISOString().slice(0, 7)))
    const start = new Date(dated[0].date)
    const end = new Date(dated[dated.length - 1].date)
    const gaps: string[] = []
    const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1))
    while (cur <= end && gaps.length < 6) {
      const key = cur.toISOString().slice(0, 7)
      if (!monthsWith.has(key)) gaps.push(key)
      cur.setUTCMonth(cur.getUTCMonth() + 1)
    }
    if (gaps.length) {
      out.push({
        kind: 'timeline_gap',
        description: `No evidence covers: ${gaps.join(', ')} — the record is silent for these period(s).`,
        relatedEventID: null, relatedClaimID: null, severity: 'info'
      })
    }
  }

  return out.slice(0, 40)
}

/** Aggregate counts for the Fact Status Matrix header. */
export function factMatrix(repos: Repos): FactMatrix {
  const counts = repos.events.statusCounts()
  return {
    observed: counts['observed'] ?? 0,
    asserted: counts['asserted'] ?? 0,
    derived: counts['derived'] ?? 0,
    inferred: counts['inferred'] ?? 0,
    contradicted: counts['contradicted'] ?? 0,
    unsupported: counts['unsupported'] ?? 0,
    totalEvents: repos.events.count(),
    corroborated: repos.events.corroboratedCount(),
    contradictions: repos.contradictions.count(),
    missingProof: missingProof(repos).length
  }
}
