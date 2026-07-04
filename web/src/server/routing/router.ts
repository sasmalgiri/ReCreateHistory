//
// router.ts — deterministic routing (ported from DeterministicRouter.swift).
// Given a UserIntent, decide which experts run, which retrieval layers are
// consulted, parallelism, complexity, and the answer CapabilitySpec. The
// router NEVER names a model — it describes what the answer call needs.
//

import type { UserIntent, RoutingDecision, RetrievalLayer, CapabilitySpec } from '../../shared/ai'
import { RETRIEVAL_PRIORITY } from '../../shared/ai'

function reasoningSpec(purpose: string, contextTokens = 4000): CapabilitySpec {
  return {
    requires: ['textGeneration', 'reasoning'],
    prefers: ['structuredOutput', 'longContext'],
    maxLatency: 'background',
    privacy: 'localNetwork',
    estimatedContextTokens: contextTokens,
    purpose
  }
}

/** Which experts to run per intent. Mirrors the ExpertRegistry mapping. */
function expertsFor(intent: UserIntent): string[] {
  const q = intent.rawQuestion.toLowerCase()
  const set = new Set<string>(['research']) // research/general expert always runs
  if (/\b(email|mail|inbox|sent|received|thread|reply)\b/.test(q)) set.add('email')
  if (/\b(invoice|payment|paid|cost|revenue|price|\$|budget|amount)\b/.test(q)) set.add('financial')
  if (/\b(contract|agreement|clause|legal|nda|terms|obligation)\b/.test(q)) set.add('legal')
  if (/\b(timeline|when|date|schedule|deadline)\b/.test(q)) set.add('timeline')
  if (/\b(project|deliverable|milestone|status)\b/.test(q)) set.add('project')
  switch (intent.kind) {
    case 'reconstructTimeline': set.add('timeline'); break
    case 'reconstructProject': set.add('project'); set.add('timeline'); break
    case 'reconstructRelationship': set.add('project'); break
    case 'riskDetection': set.add('project'); set.add('financial'); break
    default: break
  }
  return [...set]
}

export class DeterministicRouter {
  route(intent: UserIntent): RoutingDecision {
    const experts = expertsFor(intent)
    let complexity = 2
    let layers: RetrievalLayer[] = RETRIEVAL_PRIORITY
    switch (intent.kind) {
      case 'factualLookup':
        complexity = 1
        layers = ['memory', 'entity', 'metadata', 'vector']
        break
      case 'semanticSearch':
        complexity = 2
        layers = ['metadata', 'summary', 'vector']
        break
      case 'reconstructTimeline':
      case 'reconstructProject':
      case 'reconstructRelationship':
        complexity = 4
        layers = RETRIEVAL_PRIORITY
        break
      case 'executiveBriefing':
        complexity = 3
        layers = ['memory', 'summary', 'timeline', 'entity']
        break
      case 'riskDetection':
        complexity = 3
        layers = ['memory', 'timeline', 'entity', 'metadata', 'vector']
        break
      case 'missingInformation':
        complexity = 3
        layers = RETRIEVAL_PRIORITY
        break
      default:
        break
    }
    return {
      answerSpec: reasoningSpec(`answer.${intent.kind}`, complexity >= 4 ? 6000 : 4000),
      expertIDs: experts,
      retrievalLayers: layers,
      parallelism: Math.min(experts.length, 4),
      complexity,
      rationale: `intent=${intent.kind} experts=[${experts.join(',')}] layers=[${layers.join(',')}]`
    }
  }
}
