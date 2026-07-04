//
// summarizer.ts — hierarchical summaries. Ported from Knowledge/Summaries/
// {HeuristicSummarizer,LLMSummarizer}. Uses the LLM via CapabilityRegistry
// when a reasoning model resolves; otherwise a deterministic extractive
// fallback so the app is never dead without Ollama.
//

import type { CapabilityRegistry } from '../routing/capabilityRegistry'
import type { CapabilitySpec } from '../../shared/ai'

const SUMMARY_SPEC: CapabilitySpec = {
  requires: ['textGeneration', 'summarization'],
  prefers: ['longContext', 'reasoning'],
  maxLatency: 'background', privacy: 'localNetwork',
  estimatedContextTokens: 8000, purpose: 'summarize'
}

export class Summarizer {
  constructor(private capabilities: CapabilityRegistry) {}

  async summarize(text: string, opts?: { maxSentences?: number; title?: string }): Promise<string> {
    const trimmed = text.slice(0, 12000)
    const llm = await this.capabilities.tryGenerate(
      SUMMARY_SPEC,
      `Summarize the following${opts?.title ? ` (${opts.title})` : ''} in 2-4 sentences. Be factual and specific.\n\n${trimmed}`,
      { maxTokens: 300, temperature: 0.3 }
    )
    if (llm && llm.trim().length > 20) return llm.trim()
    return extractiveSummary(text, opts?.maxSentences ?? 3)
  }
}

export function extractiveSummary(text: string, maxSentences = 3): string {
  const sentences = text.replace(/\s+/g, ' ').match(/[^.!?]{20,300}[.!?]/g) ?? []
  if (!sentences.length) return text.slice(0, 240)
  // Score by term frequency of informative words.
  const freq = new Map<string, number>()
  for (const w of text.toLowerCase().match(/[a-z]{4,}/g) ?? []) freq.set(w, (freq.get(w) ?? 0) + 1)
  const scored = sentences.map((s, i) => {
    let score = 0
    for (const w of s.toLowerCase().match(/[a-z]{4,}/g) ?? []) score += freq.get(w) ?? 0
    return { s: s.trim(), score: score / Math.sqrt(s.length), i }
  })
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSentences)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s)
    .join(' ')
}
