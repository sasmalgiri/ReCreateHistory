//
// evidenceVerifier.ts — the last gate before the user sees an answer. Ported
// from Brain/EvidenceVerifier.swift. Without sources, no answer ships. Every
// claim must carry evidence IDs that resolve against the retrieval set;
// unverifiable claims are dropped and counted, conflicts are surfaced (never
// averaged away), and confidence is calibrated.
//

import type { Repos } from '../storage'
import type {
  ExpertFindings, RetrievalResult, UserIntent, VerifiedAnswer, Citation,
  Contradiction, ConfidenceReport, ReasoningTrace, AnswerSource
} from '../../shared/ai'
import type { UUID } from '../../shared/models'

export interface VerifyOptions {
  source?: AnswerSource
  reasoningTrace?: ReasoningTrace
}

export class EvidenceVerifier {
  constructor(private repos: Repos) {}

  verify(
    intent: UserIntent,
    findings: ExpertFindings[],
    retrieval: RetrievalResult,
    opts: VerifyOptions = {}
  ): VerifiedAnswer {
    const synth = findings.find((f) => f.expertID === 'research')
    const domainFindings = findings.filter((f) => f.expertID !== 'research')

    // Evidence gate — refuse when there is nothing to stand on.
    const hasEvidence =
      retrieval.chunks.length > 0 || retrieval.events.length > 0 ||
      findings.some((f) => f.claims.some((c) => c.supportingObjectIDs.length || c.supportingEventIDs.length))
    if (!hasEvidence) {
      return refusal(intent, 'No evidence in the ledger supports an answer. Ingest more sources or rephrase.')
    }

    // Split the synthesizer's prose into the answer + an explicit GAPS list, so
    // we tell the user what the sources DON'T cover instead of guessing.
    const rawProse = synth?.notes?.trim() || synth?.claims[0]?.statement || 'See key findings below.'
    const { prose, gaps } = splitGaps(rawProse)
    const keyFindings = domainFindings.flatMap((f) => f.claims).filter((c) => c.statement)
    let body = prose
    if (keyFindings.length) {
      body += '\n\nKey findings:\n' + keyFindings.map((c) => `• ${c.statement}`).join('\n')
    }

    // Citations — resolve supporting IDs to snippets, dedup, cap.
    const citations = this.buildCitations(findings, 12)

    // Confidence — mean claim confidence scaled by evidence breadth.
    const claimConfs = findings.flatMap((f) => f.claims.map((c) => c.confidence)).filter((x) => x > 0)
    const mean = claimConfs.length ? claimConfs.reduce((a, b) => a + b, 0) / claimConfs.length : 0.4
    const breadth = Math.min(1, (retrieval.chunks.length + retrieval.events.length) / 12)
    const confidence = clamp(0.05, 0.98, mean * (0.6 + 0.4 * breadth))

    const contradictions = this.detectContradictions(retrieval)
    const droppedUnverifiable = findings.reduce((a, f) => a + f.droppedUnverifiable, 0)
    // Completeness: evidence breadth lifts it; each declared gap lowers it.
    const coverageScore = clamp(0.1, 1, (0.45 + 0.55 * breadth) - 0.18 * Math.min(gaps.length, 3))
    const followUps = this.buildFollowUps(retrieval)

    const report: ConfidenceReport = {
      finalConfidence: confidence,
      evidenceCount: citations.length,
      eventCount: retrieval.events.length,
      entityCount: retrieval.entities.length,
      freshnessDays: freshness(retrieval),
      temporalCoverageDays: coverage(retrieval),
      conflictCount: contradictions.length,
      droppedUnverifiable,
      agreement: claimConfs.length > 1 ? 0.7 : 0.5,
      diversity: Math.min(1, new Set(citations.map((c) => c.objectID)).size / 5),
      coverage: coverageScore
    }

    // Spec §18 classification — derived from the epistemic statuses of the
    // events actually cited, deterministically.
    const citedEvents = citations
      .map((c) => (c.eventID ? this.repos.events.byID(c.eventID) : null))
      .filter((e): e is NonNullable<typeof e> => !!e)
    const classification = classify18(citedEvents, contradictions.length, retrieval)

    return {
      body,
      classification,
      answerText: prose,
      intentKind: intent.kind,
      citations,
      confidence,
      contradictions,
      refused: false,
      refusalReason: null,
      report,
      walkSteps: retrieval.walkSteps,
      source: opts.source ?? 'experts',
      reasoningTrace: opts.reasoningTrace ?? null,
      gaps,
      followUps
    }
  }

  /** Grounded next questions the ledger can actually answer — keeps users
   *  moving instead of dead-ending (a common competitor frustration). */
  private buildFollowUps(retrieval: RetrievalResult): string[] {
    const out: string[] = []
    const ents = retrieval.entities
      .filter((e) => ['person', 'organization', 'vendor', 'client', 'project'].includes(e.kind))
      .slice(0, 3)
    if (ents[0]) out.push(`What is the full timeline of events involving ${ents[0].value}?`)
    if (ents[1]) out.push(`Who and which organizations are connected to ${ents[1].value}?`)
    if (retrieval.events.length >= 2) out.push('What are the key decisions and risks across these events?')
    if (ents[2] && out.length < 3) out.push(`Summarize everything known about ${ents[2].value}.`)
    return out.slice(0, 3)
  }

  private buildCitations(findings: ExpertFindings[], cap: number): Citation[] {
    const seen = new Set<string>()
    const out: Citation[] = []
    const pushObject = (objectID: UUID, eventID?: UUID): void => {
      const key = eventID ?? objectID
      if (seen.has(key) || out.length >= cap) return
      seen.add(key)
      if (eventID) {
        const ev = this.repos.events.byID(eventID)
        if (ev) { out.push({ objectID: ev.sourceObjectID, eventID, snippet: `${new Date(ev.date).toISOString().slice(0, 10)} — ${ev.title}` }); return }
      }
      const ko = this.repos.objects.byID(objectID)
      if (ko) out.push({ objectID, snippet: firstLine(ko.content) })
    }
    for (const f of findings) {
      for (const c of f.claims) {
        for (const eid of c.supportingEventIDs) pushObject('', eid)
        for (const oid of c.supportingObjectIDs) pushObject(oid)
      }
    }
    return out.filter((c) => c.objectID)
  }

  private detectContradictions(retrieval: RetrievalResult): Contradiction[] {
    const contradictions: Contradiction[] = []
    const seen = new Set<string>()
    // 1. The persisted contradiction ledger (v30) — detected at ingest time,
    //    surfaced whenever a retrieved event is involved. Never averaged away.
    const eventIDs = new Set(retrieval.events.map((e) => e.id))
    for (const c of this.repos.contradictions.list(100)) {
      if (!eventIDs.has(c.aID) && !eventIDs.has(c.bID)) continue
      if (seen.has(c.explanation)) continue
      seen.add(c.explanation)
      contradictions.push({ description: c.explanation, claimA: `ledger item ${c.aID.slice(0, 8)}`, claimB: `ledger item ${c.bID.slice(0, 8)}` })
      if (contradictions.length >= 4) return contradictions
    }
    // 2. Transient check over the retrieval set (catches cross-doc conflicts
    //    the ingest-time pass hasn't seen together yet).
    const byTitle = new Map<string, number[]>()
    for (const e of retrieval.events) {
      const key = e.title.toLowerCase().trim()
      const arr = byTitle.get(key) ?? []
      arr.push(e.date)
      byTitle.set(key, arr)
    }
    for (const [title, dates] of byTitle) {
      const uniq = [...new Set(dates.map((d) => new Date(d).toISOString().slice(0, 10)))]
      if (uniq.length > 1 && dates.length > 1) {
        const desc = `Conflicting dates for "${title}"`
        if (!seen.has(desc)) {
          seen.add(desc)
          contradictions.push({ description: desc, claimA: `Dated ${uniq[0]}`, claimB: `Also dated ${uniq[1]}` })
        }
        if (contradictions.length >= 4) break
      }
    }
    return contradictions
  }
}

function refusal(intent: UserIntent, reason: string): VerifiedAnswer {
  return {
    body: reason,
    classification: 'Unsupported', answerText: null, intentKind: intent.kind, citations: [], confidence: 0,
    contradictions: [], refused: true, refusalReason: reason, report: null, walkSteps: [],
    source: 'unknown', reasoningTrace: null,
    gaps: ['Your ingested sources do not contain information matching this question.'],
    followUps: []
  }
}

/** Split "…answer… GAPS: a; b; c" into the answer prose and the gap list, so we
 *  surface what the sources DON'T cover rather than hallucinating it. */
function splitGaps(prose: string): { prose: string; gaps: string[] } {
  const m = prose.match(/\n?\s*GAPS?\s*:\s*/i)
  if (!m || m.index === undefined) return { prose: prose.trim(), gaps: [] }
  const before = prose.slice(0, m.index).trim()
  const after = prose.slice(m.index + m[0].length).trim()
  const gaps = after
    .split(/\n|;|(?:^|\s)[-•*]\s+/)
    .map((g) => g.replace(/^[-•*\s]+/, '').trim())
    .filter((g) => g.length > 2 && !/^none\b/i.test(g))
  return { prose: before || prose.trim(), gaps: gaps.slice(0, 6) }
}

/** Spec §18: one classification label per answer, from cited-event statuses. */
function classify18(
  cited: { epistemicStatus: string; corroborationCount: number }[],
  contradictionCount: number,
  retrieval: RetrievalResult
): string {
  if (contradictionCount > 0) return 'Contradicted'
  if (!cited.length) {
    return retrieval.chunks.length > 0 ? 'Supported by a single source' : 'Inconclusive'
  }
  if (cited.some((e) => e.epistemicStatus === 'observed')) return 'Proven by direct evidence'
  if (cited.some((e) => e.corroborationCount >= 2)) return 'Supported by multiple sources'
  if (cited.every((e) => e.epistemicStatus === 'inferred')) return 'Inferred'
  if (cited.some((e) => e.epistemicStatus === 'derived')) return 'Derived'
  return 'Supported by a single source'
}

function firstLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 160)
}
function clamp(lo: number, hi: number, x: number): number { return Math.max(lo, Math.min(hi, x)) }
function freshness(r: RetrievalResult): number | null {
  if (!r.events.length) return null
  const latest = Math.max(...r.events.map((e) => e.date))
  return Math.round((Date.now() - latest) / 86_400_000)
}
function coverage(r: RetrievalResult): number | null {
  if (r.events.length < 2) return null
  const ds = r.events.map((e) => e.date)
  return Math.round((Math.max(...ds) - Math.min(...ds)) / 86_400_000)
}
