//
// intentDetector.ts — rule-based intent detection (ported from
// IntentDetector.swift's RuleIntentDetector). Cheap, deterministic, no LLM.
// The Router turns the detected UserIntent into a RoutingDecision.
//

import type { UserIntent, IntentKind } from '../../shared/ai'

const YEAR_RE = /\b(19|20)\d{2}\b/g

export class RuleIntentDetector {
  detect(question: string): UserIntent {
    const q = question.toLowerCase()
    const kind = classify(q)
    const entityHints = extractHints(question)
    const timeframe = extractTimeframe(question)
    return {
      kind,
      scope: { type: 'global' },
      timeframe,
      entityHints,
      rawQuestion: question
    }
  }
}

function classify(q: string): IntentKind {
  if (/\b(timeline|chronolog|when did|sequence of|over time|history of)\b/.test(q)) return 'reconstructTimeline'
  if (/\b(reconstruct|what happened (with|to|on)|the story of|full picture)\b/.test(q)) return 'reconstructProject'
  if (/\b(relationship|connection between|who worked with|how are .* related|dealings with)\b/.test(q)) return 'reconstructRelationship'
  if (/\b(brief|briefing|overview|summar|executive|recap|status of)\b/.test(q)) return 'executiveBriefing'
  if (/\b(risk|risks|problem|issue|delay|concern|blocker|overdue)\b/.test(q)) return 'riskDetection'
  if (/\b(missing|don'?t (we|i) know|gaps?|unknown|unanswered)\b/.test(q)) return 'missingInformation'
  if (/^(who|what|where|when|how much|how many|which)\b/.test(q)) return 'factualLookup'
  return 'semanticSearch'
}

function extractHints(question: string): string[] {
  const hints = new Set<string>()
  // Quoted phrases.
  for (const m of question.matchAll(/"([^"]+)"/g)) hints.add(m[1].trim())
  // Capitalized runs (proper nouns), skipping sentence-initial single words.
  for (const m of question.matchAll(/\b([A-Z][a-zA-Z0-9&.-]+(?:\s+[A-Z][a-zA-Z0-9&.-]+)*)\b/g)) {
    const v = m[1].trim()
    if (v.length > 2 && !STOP.has(v.toLowerCase())) hints.add(v)
  }
  // Email addresses.
  for (const m of question.matchAll(/[\w.+-]+@[\w.-]+\.\w+/g)) hints.add(m[0])
  return [...hints].slice(0, 8)
}

function extractTimeframe(question: string): UserIntent['timeframe'] {
  const years = [...question.matchAll(YEAR_RE)].map((m) => Number(m[0]))
  if (!years.length) return null
  const min = Math.min(...years), max = Math.max(...years)
  return {
    start: Date.UTC(min, 0, 1),
    end: Date.UTC(max, 11, 31, 23, 59, 59)
  }
}

const STOP = new Set(['who', 'what', 'where', 'when', 'why', 'how', 'the', 'did', 'was', 'is', 'are', 'i', 'we'])
