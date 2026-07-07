//
// experts.ts — experts produce findings (claims + evidence), not answers.
// Ported from Experts/*. Each is stateless: it reads the shared retrieval set
// and returns ExpertFindings. The verifier folds them into a final answer.
//
// The ResearchExpert is the synthesizer (LLM-grounded prose). The domain
// experts (email/financial/legal/timeline/project) add typed claims from the
// structured ledger. All claims carry the specific evidence IDs that back them.
//

import type { CapabilityRegistry } from '../routing/capabilityRegistry'
import type { CapabilitySpec, ExpertFindings, Claim, RetrievalResult, UserIntent } from '../../shared/ai'
import type { KEvent, Entity } from '../../shared/models'

const REASONING_SPEC: CapabilitySpec = {
  requires: ['textGeneration', 'reasoning'],
  prefers: ['structuredOutput', 'longContext'],
  maxLatency: 'background', privacy: 'localNetwork',
  estimatedContextTokens: 6000, purpose: 'expert.reasoning'
}

export interface Expert {
  id: string
  analyze(intent: UserIntent, retrieval: RetrievalResult): Promise<ExpertFindings>
}

/** Numbered evidence list shared by the synthesizer prompt + citation mapping. */
export interface EvidenceItem {
  tag: string // E1, E2...
  objectID: string
  chunkID?: string
  eventID?: string
  text: string
}

export function buildEvidence(retrieval: RetrievalResult): EvidenceItem[] {
  const items: EvidenceItem[] = []
  let n = 1
  // Rich slices — starving the model of context produces shallow answers.
  for (const rc of retrieval.chunks.slice(0, 16)) {
    items.push({ tag: `E${n++}`, objectID: rc.chunk.objectID, chunkID: rc.chunk.id, text: rc.chunk.text.slice(0, 900) })
  }
  for (const ev of retrieval.events.slice(0, 14)) {
    items.push({
      tag: `E${n++}`, objectID: ev.sourceObjectID, eventID: ev.id,
      text: `[${new Date(ev.date).toISOString().slice(0, 10)}] ${ev.title}${ev.summary && ev.summary !== ev.title ? ' — ' + ev.summary : ''}`
    })
  }
  return items
}

// ── Research / synthesizer expert (LLM-grounded) ────────────────────────

export class ResearchExpert implements Expert {
  id = 'research'
  constructor(private capabilities: CapabilityRegistry) {}

  async analyze(intent: UserIntent, retrieval: RetrievalResult): Promise<ExpertFindings> {
    const evidence = buildEvidence(retrieval)
    if (!evidence.length) {
      return { expertID: this.id, claims: [], confidence: 0, notes: null, droppedUnverifiable: 0 }
    }
    const context = evidence.map((e) => `${e.tag}: ${e.text}`).join('\n')
    // The user wants THE answer — perfect or near it. So this is a refinement
    // pipeline, not a single shot: draft → self-critique against the question
    // and evidence → revise. The critique pass catches the two big failures
    // users hate: claims the evidence doesn't support, and parts of the
    // question silently left unanswered.
    const answer = await this.draftCritiqueRevise(intent.rawQuestion, context)
    // Grounding gate — ENFORCED, not just prompted. Every LLM sentence must be
    // supported by the evidence (numbers/dates hard-checked, content overlap
    // scored); unsupported sentences are dropped and counted. This is what
    // stops the model answering from its trained knowledge.
    let prose: string
    let droppedUnverifiable = 0
    if (answer?.trim()) {
      const gated = groundProse(answer.trim(), evidence)
      droppedUnverifiable = gated.dropped
      prose = gated.text || heuristicProse(intent, retrieval, evidence)
    } else {
      prose = heuristicProse(intent, retrieval, evidence)
    }
    const cited = new Set([...prose.matchAll(/\[E(\d+)\]/g)].map((m) => `E${m[1]}`))

    const supportingObjectIDs = new Set<string>()
    const supportingEventIDs = new Set<string>()
    for (const e of evidence) {
      if (cited.has(e.tag) || cited.size === 0) {
        supportingObjectIDs.add(e.objectID)
        if (e.eventID) supportingEventIDs.add(e.eventID)
      }
    }
    const claim: Claim = {
      statement: prose,
      supportingObjectIDs: [...supportingObjectIDs],
      supportingEventIDs: [...supportingEventIDs],
      supportingEntityIDs: retrieval.entities.slice(0, 8).map((e) => e.id),
      confidence: answer ? 0.7 : 0.5,
      evidenceGranularity: answer && cited.size > 0 ? 'specific' : 'coarse'
    }
    return {
      expertID: this.id, claims: [claim], confidence: claim.confidence,
      notes: prose, droppedUnverifiable
    }
  }

  /** Draft → self-critique → revise. Returns null when no LLM resolves. */
  private async draftCritiqueRevise(question: string, context: string): Promise<string | null> {
    const rules =
      `Rules — follow every one:\n` +
      `1. Lead with a direct, specific answer to exactly what was asked (real names, dates, amounts).\n` +
      `2. Support every statement with inline [E#] citations. State NOTHING the evidence does not support — no guessing, no outside knowledge.\n` +
      `3. Be complete: address each part of the question that the evidence can cover.\n` +
      `4. If the evidence does not cover part of the question, do NOT invent it. Finish with one line starting "GAPS:" listing briefly what the sources do not answer.\n` +
      `5. No preamble, no filler.\n`

    const draft = await this.capabilities.tryGenerate(
      REASONING_SPEC,
      `You are a meticulous archival analyst. Answer the QUESTION using ONLY the numbered EVIDENCE.\n${rules}\nEVIDENCE:\n${context}\n\nQUESTION: ${question}\n\nANSWER:`,
      { maxTokens: 1100, temperature: 0.2 }
    )
    if (!draft?.trim()) return null

    // Critique: a strict reviewer looking for exactly the failures users hate.
    const critique = await this.capabilities.tryGenerate(
      REASONING_SPEC,
      `You are a strict reviewer. Below are a QUESTION, the only allowed EVIDENCE, and a DRAFT answer.\n` +
        `If the draft (a) directly and fully answers every part of the question that the evidence can cover, ` +
        `(b) contains no claim unsupported by the evidence, and (c) is specific (names, dates, amounts), reply with exactly: OK\n` +
        `Otherwise, list each problem on its own line: unsupported claims, question parts left unanswered, vague or wrong specifics.\n\n` +
        `EVIDENCE:\n${context}\n\nQUESTION: ${question}\n\nDRAFT:\n${draft}\n\nREVIEW:`,
      { maxTokens: 350, temperature: 0.1 }
    )
    const verdict = critique?.trim() ?? ''
    if (!verdict || /^OK\b/i.test(verdict)) return draft

    // Revise: fix exactly what the reviewer found, nothing else.
    const revised = await this.capabilities.tryGenerate(
      REASONING_SPEC,
      `You are a meticulous archival analyst. Improve the DRAFT answer by fixing ONLY the problems in the REVIEW, ` +
        `using ONLY the numbered EVIDENCE.\n${rules}\nEVIDENCE:\n${context}\n\nQUESTION: ${question}\n\nDRAFT:\n${draft}\n\nREVIEW:\n${verdict}\n\nFINAL ANSWER:`,
      { maxTokens: 1200, temperature: 0.2 }
    )
    return revised?.trim() || draft
  }
}

// ── Grounding gate (deterministic, rule-based) ──────────────────────────

const PROSE_STOP = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'for', 'was', 'were', 'are',
  'has', 'have', 'had', 'their', 'they', 'them', 'there', 'which', 'while',
  'when', 'where', 'these', 'those', 'into', 'about', 'also', 'been', 'both',
  'after', 'before', 'during', 'between', 'sources', 'evidence', 'according'
])

function proseWords(s: string): string[] {
  return (s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !PROSE_STOP.has(w))
}

/** Normalize number tokens so "12,500" matches "$12,500" and "12500". */
function normNums(s: string): string[] {
  return (s.match(/\d[\d,./-]*\d|\d/g) ?? []).map((n) => n.replace(/[,\s]/g, '').replace(/[./-]+$/, ''))
}

export interface GroundedProse { text: string; dropped: number }

/**
 * Sentence-level grounding check of LLM prose against the evidence set.
 * A sentence survives only if:
 *   - every number/date it states appears in the evidence (hard check — this
 *     is the classic hallucination catcher), AND
 *   - its content words sufficiently overlap the evidence (looser when the
 *     sentence carries a valid [E#] citation).
 * GAPS lines pass through untouched (they describe absence, not facts).
 */
export function groundProse(prose: string, evidence: EvidenceItem[]): GroundedProse {
  const evAll = evidence.map((e) => e.text).join(' ').toLowerCase()
  const evWordSet = new Set(proseWords(evAll))
  const evNums = new Set(normNums(evAll))
  const maxTag = evidence.length

  const out: string[] = []
  let dropped = 0
  // Split into sentences, keeping the GAPS block separate.
  const gapsIdx = prose.search(/\n?\s*GAPS?\s*:/i)
  const main = gapsIdx >= 0 ? prose.slice(0, gapsIdx) : prose
  const gapsTail = gapsIdx >= 0 ? prose.slice(gapsIdx).trim() : ''

  for (const raw of main.split(/(?<=[.!?])\s+/)) {
    const sentence = raw.trim()
    if (!sentence) continue
    const words = proseWords(sentence)
    if (words.length === 0) { out.push(sentence); continue } // pure framing

    // Hard check: every stated number/date must exist somewhere in evidence.
    const numsOk = normNums(sentence).every((n) => evNums.has(n) || evAll.includes(n.toLowerCase()))

    // Citation-aware overlap: a valid [E#] earns a looser threshold.
    const tags = [...sentence.matchAll(/\[E(\d+)\]/g)].map((m) => Number(m[1]))
    const hasValidTag = tags.some((t) => t >= 1 && t <= maxTag)
    const overlap = words.filter((w) => evWordSet.has(w)).length / words.length
    const supported = numsOk && overlap >= (hasValidTag ? 0.25 : 0.5)

    if (supported) out.push(sentence)
    else dropped++
  }

  let text = out.join(' ').trim()
  if (gapsTail) text = `${text}\n${gapsTail}`.trim()
  // If the gate gutted the answer, signal the caller to use the ledger fallback.
  if (out.join(' ').replace(/\s+/g, ' ').length < 40) return { text: '', dropped }
  return { text, dropped }
}

/** Offline fallback: readable, chronological prose composed from the ledger —
 *  real sentences, never bullet fragments. */
function heuristicProse(intent: UserIntent, retrieval: RetrievalResult, evidence: EvidenceItem[]): string {
  const events = [...retrieval.events].sort((a, b) => a.date - b.date)
  const parts: string[] = []
  if (events.length) {
    const first = new Date(events[0].date).toISOString().slice(0, 10)
    const last = new Date(events[events.length - 1].date).toISOString().slice(0, 10)
    const span = first === last ? `on ${first}` : `between ${first} and ${last}`
    const seen = new Set<string>()
    const lines: string[] = []
    for (const e of events) {
      const when = new Date(e.date).toISOString().slice(0, 10)
      const what = (e.title || e.summary || 'an event was recorded').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '')
      const key = what.toLowerCase()
      if (seen.has(key)) continue // same sentence extracted at multiple precisions
      seen.add(key)
      // Sentences that already open with their own time phrase stand alone;
      // prefixing "On {date}," onto "On 2025-03-14, Acme…" reads as a stutter.
      const startsTemporal = /^(on|in|by|between|during|as of|since|from)\b/i.test(what)
      lines.push(startsTemporal ? `${what[0].toUpperCase()}${what.slice(1)}.` : `On ${when}, ${lowerFirst(what)}.`)
      if (lines.length >= 8) break
    }
    parts.push(`Your sources record ${lines.length} dated event${lines.length === 1 ? '' : 's'} ${span}. In order:\n\n${lines.join('\n')}`)
  }
  const passages = evidence.filter((e) => e.chunkID).slice(0, 2)
  if (passages.length && !events.length) {
    parts.push(`The most relevant passage in your sources says: "${passages[0].text.slice(0, 260).trim()}…"`)
  }
  if (!parts.length) return `Your ingested sources contain nothing matching "${intent.rawQuestion}". Ingest more documents or rephrase.`
  return parts.join('\n\n')
}

function lowerFirst(s: string): string {
  // Keep acronyms/proper starts intact; only lower obvious sentence-case starts.
  if (/^[A-Z][a-z]/.test(s) && !/^(I\b|[A-Z][a-z]+ [A-Z])/.test(s)) return s[0].toLowerCase() + s.slice(1)
  return s
}

// ── Domain experts (structured-ledger claims) ───────────────────────────

class DomainExpert implements Expert {
  constructor(
    public id: string,
    private eventKinds: string[],
    private label: (evs: KEvent[], ents: Entity[]) => Claim[]
  ) {}
  async analyze(_intent: UserIntent, retrieval: RetrievalResult): Promise<ExpertFindings> {
    const evs = retrieval.events.filter((e) => this.eventKinds.length === 0 || this.eventKinds.includes(e.kind))
    const claims = this.label(evs, retrieval.entities)
    const conf = claims.length ? Math.max(...claims.map((c) => c.confidence)) : 0
    return { expertID: this.id, claims, confidence: conf, notes: null, droppedUnverifiable: 0 }
  }
}

function evidenceOf(evs: KEvent[]): Pick<Claim, 'supportingEventIDs' | 'supportingObjectIDs'> {
  return {
    supportingEventIDs: evs.map((e) => e.id).slice(0, 12),
    supportingObjectIDs: [...new Set(evs.map((e) => e.sourceObjectID))].slice(0, 12)
  }
}

export function makeDomainExperts(): Expert[] {
  return [
    new DomainExpert('email', ['emailSent', 'emailReceived'], (evs) => {
      if (!evs.length) return []
      return [{
        statement: `${evs.length} email event(s) relate to this question, spanning ${dateSpan(evs)}.`,
        supportingEntityIDs: [], confidence: 0.6, evidenceGranularity: 'coarse', ...evidenceOf(evs)
      }]
    }),
    new DomainExpert('financial', ['invoiceIssued', 'invoicePaid'], (evs, ents) => {
      const money = ents.filter((e) => e.kind === 'money').slice(0, 6)
      const claims: Claim[] = []
      if (evs.length) claims.push({
        statement: `${evs.length} financial event(s) found (invoices/payments), ${dateSpan(evs)}.`,
        supportingEntityIDs: money.map((m) => m.id), confidence: 0.6, evidenceGranularity: 'coarse', ...evidenceOf(evs)
      })
      if (money.length) claims.push({
        statement: `Monetary amounts referenced: ${money.map((m) => m.value).join(', ')}.`,
        supportingEntityIDs: money.map((m) => m.id), supportingEventIDs: [], supportingObjectIDs: [],
        confidence: 0.5, evidenceGranularity: 'coarse'
      })
      return claims
    }),
    new DomainExpert('legal', ['contractSigned', 'contractModified'], (evs) => {
      if (!evs.length) return []
      return [{
        statement: `${evs.length} contract-related event(s) found, ${dateSpan(evs)}.`,
        supportingEntityIDs: [], confidence: 0.6, evidenceGranularity: 'coarse', ...evidenceOf(evs)
      }]
    }),
    new DomainExpert('timeline', [], (evs) => {
      if (evs.length < 2) return []
      return [{
        statement: `The evidence spans ${dateSpan(evs)} across ${evs.length} dated events.`,
        supportingEntityIDs: [], confidence: 0.65, evidenceGranularity: 'coarse', ...evidenceOf(evs.slice(0, 15))
      }]
    }),
    new DomainExpert('project', ['deliveryDelayed', 'deliveryCompleted', 'taskAssigned', 'meetingHeld'], (evs) => {
      if (!evs.length) return []
      const delayed = evs.filter((e) => e.kind === 'deliveryDelayed').length
      return [{
        statement: `${evs.length} project event(s) found${delayed ? `, including ${delayed} delay(s)` : ''}.`,
        supportingEntityIDs: [], confidence: 0.6, evidenceGranularity: 'coarse', ...evidenceOf(evs)
      }]
    })
  ]
}

function dateSpan(evs: KEvent[]): string {
  if (!evs.length) return 'no dates'
  const ds = evs.map((e) => e.date).sort((a, b) => a - b)
  const a = new Date(ds[0]).toISOString().slice(0, 10)
  const b = new Date(ds[ds.length - 1]).toISOString().slice(0, 10)
  return a === b ? a : `${a} → ${b}`
}
