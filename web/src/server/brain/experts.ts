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
  for (const rc of retrieval.chunks.slice(0, 12)) {
    items.push({ tag: `E${n++}`, objectID: rc.chunk.objectID, chunkID: rc.chunk.id, text: rc.chunk.text.slice(0, 500) })
  }
  for (const ev of retrieval.events.slice(0, 10)) {
    items.push({
      tag: `E${n++}`, objectID: ev.sourceObjectID, eventID: ev.id,
      text: `[${new Date(ev.date).toISOString().slice(0, 10)}] ${ev.title}${ev.summary ? ' — ' + ev.summary : ''}`
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
    const prompt =
      `You are a meticulous archival analyst answering ONLY from the numbered evidence below.\n` +
      `Cite the evidence you use inline as [E#]. If the evidence is insufficient, say so plainly.\n` +
      `Do not invent facts. Be specific with names, dates, and amounts.\n\n` +
      `EVIDENCE:\n${context}\n\nQUESTION: ${intent.rawQuestion}\n\nANSWER (with [E#] citations):`

    const answer = await this.capabilities.tryGenerate(REASONING_SPEC, prompt, { maxTokens: 700, temperature: 0.3 })
    const prose = answer?.trim() || heuristicProse(intent, retrieval, evidence)
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
      notes: prose, droppedUnverifiable: 0
    }
  }
}

function heuristicProse(intent: UserIntent, retrieval: RetrievalResult, evidence: EvidenceItem[]): string {
  const parts: string[] = []
  if (retrieval.events.length) {
    const top = retrieval.events.slice(0, 5).map((e) => `• ${new Date(e.date).toISOString().slice(0, 10)}: ${e.title}`)
    parts.push(`Based on the ledger, the most relevant dated events are:\n${top.join('\n')}`)
  }
  if (retrieval.chunks.length) {
    parts.push(`Relevant passages: ${evidence.filter((e) => e.chunkID).slice(0, 2).map((e) => `"${e.text.slice(0, 160)}…"`).join(' ')}`)
  }
  if (!parts.length) return `No grounded evidence was found for: "${intent.rawQuestion}". Try ingesting more sources or rephrasing.`
  return parts.join('\n\n')
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
