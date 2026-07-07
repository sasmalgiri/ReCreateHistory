//
// reportBuilder.ts — the exportable chronology report (spec §23.10). A
// deterministic Markdown document: fact-status matrix, source manifest with
// SHA-256 hashes, the status-tagged timeline with citations, the contradiction
// ledger, missing proof, and claims — the deliverable for court, investigation,
// journalism, and research use. No LLM anywhere in this file.
//

import type { Repos } from '../storage'
import type { KEvent } from '../../shared/models'
import { factMatrix, missingProof } from './factStatus'

export function buildChronologyReport(repos: Repos): string {
  const now = new Date().toISOString()
  const m = factMatrix(repos)
  const files = repos.files.list(500)
  const events = repos.events.all(2000).filter((e) => (e.title || '').toLowerCase() !== 'document ingested')
  const contradictions = repos.contradictions.list(100)
  const missing = missingProof(repos)
  const claims = repos.claims.list(undefined, 500)
  const objects = new Map(repos.objects.list(1000).map((o) => [o.id, o]))

  const L: string[] = []
  L.push('# Reconstructed Chronology Report')
  L.push('')
  L.push(`Generated: ${now}  `)
  L.push(`Engine: ReCreateHistory evidence ledger (deterministic reconstruction; AI used only for language polish, fact-locked).`)
  L.push('')
  L.push('> Every event below is labeled by HOW it is known. Nothing in this report is')
  L.push('> asserted beyond what the listed sources support. Contradictions are shown,')
  L.push('> not resolved. Inferred items are inference, not established fact.')
  L.push('')

  // ── Fact Status Matrix ──
  L.push('## Fact Status Matrix')
  L.push('')
  L.push('| Status | Count | Meaning |')
  L.push('| --- | --- | --- |')
  L.push(`| Observed | ${m.observed} | directly visible in a structured source (header, timestamp, log) |`)
  L.push(`| Asserted | ${m.asserted} | stated in a document with an explicit date |`)
  L.push(`| Derived | ${m.derived} | computed deterministically from stated facts |`)
  L.push(`| Inferred | ${m.inferred} | indirect evidence only |`)
  L.push(`| Contradicted | ${m.contradicted} | conflicting evidence exists (see §Contradictions) |`)
  L.push(`| Corroborated ×2+ | ${m.corroborated} | backed by two or more independent sources |`)
  L.push('')

  // ── Source manifest ──
  L.push('## Source Manifest')
  L.push('')
  for (const f of files) {
    const name = f.url.split(/[\\/]/).pop()
    const dup = f.aliasOf ? ' — duplicate (alias)' : ''
    L.push(`- **${name}** (${f.sourceType}, ${f.sizeBytes} bytes)${dup}`)
    if (f.contentHash) L.push(`  SHA-256: \`${f.contentHash}\``)
  }
  L.push('')

  // ── Timeline ──
  L.push('## Reconstructed Timeline')
  L.push('')
  const byMonth = new Map<string, KEvent[]>()
  for (const e of events.sort((a, b) => a.date - b.date)) {
    const k = new Date(e.date).toISOString().slice(0, 7)
    const arr = byMonth.get(k) ?? []
    arr.push(e)
    byMonth.set(k, arr)
  }
  for (const [month, evs] of byMonth) {
    L.push(`### ${month}`)
    L.push('')
    for (const e of evs) {
      const day = new Date(e.date).toISOString().slice(0, 10)
      const src = objects.get(e.sourceObjectID)
      const srcName = src ? src.sourceFile.split(/[\\/]/).pop() : 'unknown source'
      const corr = e.corroborationCount >= 2 ? `, ${e.corroborationCount} sources` : ''
      const review = e.reviewStatus !== 'unreviewed' ? ` · review: ${e.reviewStatus}` : ''
      L.push(`- **${day}** — ${e.title.replace(/\s+/g, ' ').trim()}`)
      L.push(`  - status: **${e.epistemicStatus}**${corr} · date confidence ${Math.round(e.dateConfidence * 100)}%${review}`)
      L.push(`  - source: ${srcName}${e.statusReason ? ` · ${e.statusReason}` : ''}`)
    }
    L.push('')
  }

  // ── Contradictions ──
  L.push('## Contradictions')
  L.push('')
  if (!contradictions.length) {
    L.push('No contradictions detected across the ingested sources.')
  } else {
    for (const c of contradictions) {
      L.push(`- [${c.kind.replace(/_/g, ' ')}] ${c.explanation} _(status: ${c.resolutionStatus})_`)
    }
  }
  L.push('')

  // ── Missing proof ──
  L.push('## Missing Evidence')
  L.push('')
  if (!missing.length) {
    L.push('No evidence gaps flagged.')
  } else {
    for (const g of missing) L.push(`- [${g.kind.replace(/_/g, ' ')}] ${g.description}`)
  }
  L.push('')

  // ── Claims ──
  L.push('## Extracted Claims')
  L.push('')
  const byType = new Map<string, number>()
  for (const c of claims) byType.set(c.claimType, (byType.get(c.claimType) ?? 0) + 1)
  L.push([...byType.entries()].map(([t, n]) => `${n} ${t.replace(/_/g, ' ')}`).join(' · ') || 'none')
  L.push('')
  for (const c of claims.slice(0, 80)) {
    const src = objects.get(c.sourceObjectID)
    const srcName = src ? src.sourceFile.split(/[\\/]/).pop() : 'unknown'
    L.push(`- (${c.claimType.replace(/_/g, ' ')}) ${c.claimText.replace(/\s+/g, ' ').slice(0, 220)} — _${srcName}_`)
  }
  L.push('')
  L.push('---')
  L.push('_This report separates proven facts from inference and preserves both sides of every conflict. It is an evidence-backed reconstruction, not a definitive account._')
  return L.join('\n')
}
