//
// masterBrain.ts — the final orchestrator. Ported from Brain/MasterBrain.swift.
// Detects intent, routes (experts + retrieval layers), fans experts out over a
// shared retrieval, verifies findings into a cited answer. Holds no filesystem
// and no specific model — every AI call goes through CapabilityRegistry.
//

import type { Repos } from '../storage'
import type { CapabilityRegistry } from '../routing/capabilityRegistry'
import type { HybridRetriever } from '../retrieval/hybridRetriever'
import type { RuleIntentDetector } from '../routing/intentDetector'
import type { DeterministicRouter } from '../routing/router'
import { EvidenceVerifier } from './evidenceVerifier'
import { ResearchExpert, makeDomainExperts, type Expert } from './experts'
import type { VerifiedAnswer, ReasoningTrace, AnswerSource } from '../../shared/ai'
import type { AskUpdateBody } from '../../shared/ipc'
import { log } from '../core/logger'

export interface BrainDeps {
  repos: Repos
  capabilities: CapabilityRegistry
  retriever: HybridRetriever
  intentDetector: RuleIntentDetector
  router: DeterministicRouter
}

export class MasterBrain {
  private verifier: EvidenceVerifier
  private experts: Map<string, Expert>

  constructor(private deps: BrainDeps) {
    this.verifier = new EvidenceVerifier(deps.repos)
    this.experts = new Map()
    this.experts.set('research', new ResearchExpert(deps.capabilities))
    for (const e of makeDomainExperts()) this.experts.set(e.id, e)
  }

  async ask(question: string): Promise<VerifiedAnswer> {
    return this.run(question, () => {})
  }

  async askStream(question: string, emit: (u: AskUpdateBody) => void): Promise<VerifiedAnswer> {
    return this.run(question, emit)
  }

  private async run(question: string, emit: (u: AskUpdateBody) => void): Promise<VerifiedAnswer> {
    const q = question.trim()
    if (!q) return { body: 'Ask a question.', citations: [], confidence: 0, contradictions: [], refused: true, refusalReason: 'empty', report: null, walkSteps: [], source: 'unknown', answerText: null, intentKind: null, reasoningTrace: null }

    emit({ kind: 'stage', label: 'Detecting intent…' })
    const intent = this.deps.intentDetector.detect(q)
    const decision = this.deps.router.route(intent)
    log.brain(`ask "${q.slice(0, 50)}" → ${decision.rationale}`)

    // Phase 1 — instant memory read (tagged as verifying, never authoritative).
    const instant = this.phase1Instant(intent)
    if (instant) emit({ kind: 'instant', body: instant })

    emit({ kind: 'stage', label: 'Retrieving evidence…' })
    const retrieval = await this.deps.retriever.retrieve(intent, decision.retrievalLayers)

    emit({ kind: 'stage', label: `Consulting ${decision.expertIDs.length} expert(s)…` })
    const expertIDs = ['research', ...decision.expertIDs.filter((id) => id !== 'research')]
    const runnable = expertIDs.map((id) => this.experts.get(id)).filter((e): e is Expert => !!e)
    const findings = await Promise.all(
      runnable.map((e) => e.analyze(intent, retrieval).catch((err) => {
        log.brain.warn(`expert ${e.id} failed: ${String(err)}`)
        return { expertID: e.id, claims: [], confidence: 0, notes: null, droppedUnverifiable: 0 }
      }))
    )

    emit({ kind: 'stage', label: 'Verifying against evidence…' })
    const trace: ReasoningTrace = {
      layersFired: retrieval.layersUsed,
      expertsRun: runnable.map((e) => e.id),
      llmPurposes: ['expert.reasoning'],
      steps: [
        { label: 'Intent', detail: `${intent.kind} (complexity ${decision.complexity})` },
        { label: 'Retrieval', detail: `${retrieval.chunks.length} chunks, ${retrieval.events.length} events, ${retrieval.entities.length} entities` },
        { label: 'Experts', detail: runnable.map((e) => e.id).join(', ') }
      ],
      assumptions: instant ? ['A distilled memory existed for the subject.'] : [],
      uncertainties: retrieval.chunks.length === 0 ? ['No text chunks matched; answer rests on structured events only.'] : []
    }
    const source: AnswerSource = intent.kind.startsWith('reconstruct') ? 'historical' : 'experts'
    const answer = this.verifier.verify(intent, findings, retrieval, { source, reasoningTrace: trace })

    // Persist the turn.
    try {
      const convo = this.deps.repos.conversations.create(q.slice(0, 60))
      this.deps.repos.conversations.addTurn(convo, 0, 'user', q)
      this.deps.repos.conversations.addTurn(convo, 1, 'assistant', answer.body)
    } catch (err) {
      log.brain.warn(`persist turn failed: ${String(err)}`)
    }

    emit({ kind: 'verified', answer })
    return answer
  }

  /** Instant cached read from the Memory layer if a hinted subject matches. */
  private phase1Instant(intent: { entityHints: string[] }): string | null {
    for (const hint of intent.entityHints) {
      const ent = this.deps.repos.entities.search(hint, 1)[0]
      if (!ent) continue
      const kinds = ['organization', 'person', 'project', 'deliverable', 'topic'] as const
      for (const k of kinds) {
        const mem = this.deps.repos.memory.bySubject(k, ent.normalizedValue ?? ent.value.toLowerCase())
        if (mem && mem.narrative.trim()) return mem.narrative
      }
    }
    return null
  }

  /** Plan-and-Solve investigation: decompose → answer each → synthesize. */
  async investigate(question: string): Promise<{ investigationID: string }> {
    const invID = this.deps.repos.investigations.create(question)
    const subQs = this.decompose(question)
    const answers: string[] = []
    let ordinal = 0
    for (const sub of subQs) {
      const a = await this.ask(sub)
      this.deps.repos.investigations.addStep(invID, ordinal++, sub, a.body, a.confidence, a.citations.map((c) => c.objectID))
      answers.push(`Q: ${sub}\nA: ${a.answerText ?? a.body}`)
    }
    const synthPrompt = `Synthesize a coherent answer to "${question}" from these sub-answers:\n\n${answers.join('\n\n')}`
    const synth = await this.deps.capabilities.tryGenerate(
      { requires: ['textGeneration', 'reasoning'], prefers: ['longContext'], maxLatency: 'background', privacy: 'localNetwork', estimatedContextTokens: 6000, purpose: 'investigate.synth' },
      synthPrompt, { maxTokens: 600, temperature: 0.3 }
    )
    this.deps.repos.investigations.finish(invID, synth?.trim() || answers.join('\n\n'))
    return { investigationID: invID }
  }

  private decompose(question: string): string[] {
    // Heuristic decomposition: who/what/when/timeline sub-questions.
    const base = question.trim().replace(/\?$/, '')
    return [
      question,
      `What are the key events and dates related to: ${base}?`,
      `Who and which organizations are involved in: ${base}?`
    ]
  }
}
