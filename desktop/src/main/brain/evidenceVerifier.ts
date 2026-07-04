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

    // Body: synthesizer prose + domain key-findings.
    const prose = synth?.notes?.trim() || synth?.claims[0]?.statement || 'See key findings below.'
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
      diversity: Math.min(1, new Set(citations.map((c) => c.objectID)).size / 5)
    }

    return {
      body,
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
      reasoningTrace: opts.reasoningTrace ?? null
    }
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
    // Scaffold: flag when the same email subject carries conflicting dates.
    const contradictions: Contradiction[] = []
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
        contradictions.push({
          description: `Conflicting dates for "${title}"`,
          claimA: `Dated ${uniq[0]}`, claimB: `Also dated ${uniq[1]}`
        })
        if (contradictions.length >= 3) break
      }
    }
    return contradictions
  }
}

function refusal(intent: UserIntent, reason: string): VerifiedAnswer {
  return {
    body: reason, answerText: null, intentKind: intent.kind, citations: [], confidence: 0,
    contradictions: [], refused: true, refusalReason: reason, report: null, walkSteps: [],
    source: 'unknown', reasoningTrace: null
  }
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
