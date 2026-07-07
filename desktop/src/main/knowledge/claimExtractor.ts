//
// claimExtractor.ts — deterministic claim extraction. A claim is the layer
// between raw evidence and reconstructed events: "who/what asserted X, in
// which document, backed by which evidence blocks". Rule-based (no LLM), so
// it runs on every document at ingest without cost and never hallucinates.
//
// Claim types:
//   obligation      — shall / must / agrees to / required to …
//   date_assertion  — a sentence stating a concrete date
//   amount          — a sentence stating money
//   communication   — email header: X emailed Y on DATE re SUBJECT
//   statement       — (reserved; free statements are left to retrieval)
//

import type { EvidenceBlock, LedgerClaim, UUID } from '../../shared/models'
import { parseDates } from './dateGrammar'

const OBLIGATION_RE = /\b(shall|must|agrees? to|required to|obligated to|undertakes to|is to be|will provide|will pay|will deliver)\b/i
const MONEY_RE = /(?:[$€£₹]\s?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s?(?:USD|EUR|GBP|INR|dollars?|rupees?|euros?)\b)/i

export type NewClaim = Omit<LedgerClaim, 'id' | 'createdAt'>

export function extractClaims(objectID: UUID, blocks: EvidenceBlock[], meta: Record<string, unknown>): NewClaim[] {
  const claims: NewClaim[] = []
  const seen = new Set<string>()
  const push = (c: NewClaim): void => {
    const key = `${c.claimType}:${c.claimText.toLowerCase().replace(/\s+/g, ' ').slice(0, 160)}`
    if (seen.has(key)) return
    seen.add(key)
    claims.push(c)
  }

  // Communication claim from structured email headers (highest trust).
  if (meta.isEmail === true && meta.from) {
    push({
      claimText: `${String(meta.from)} sent an email to ${String(meta.to ?? 'unknown')}${meta.date ? ` on ${String(meta.date)}` : ''}${meta.subject ? ` regarding "${String(meta.subject)}"` : ''}.`,
      claimType: 'communication',
      assertedBy: String(meta.from),
      sourceObjectID: objectID,
      evidenceBlockIDs: blocks.filter((b) => b.blockType === 'email_message').map((b) => b.id),
      confidence: 0.95,
      extractionMethod: 'rule'
    })
  }

  for (const b of blocks) {
    const text = (b.text ?? '').trim()
    if (!text || b.blockType === 'heading') continue

    // Table rows with money-ish columns become amount claims.
    if (b.blockType === 'table_row') {
      if (MONEY_RE.test(text) || /amount|price|total|balance|paid/i.test(text)) {
        push({
          claimText: `Table row ${b.rowNum ?? '?'}${b.sheet ? ` of ${b.sheet}` : ''}: ${text.slice(0, 220)}`,
          claimType: 'amount', assertedBy: null, sourceObjectID: objectID,
          evidenceBlockIDs: [b.id], confidence: 0.9, extractionMethod: 'rule'
        })
      }
      continue
    }

    // Sentence-level claims from prose blocks.
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      const s = sentence.trim()
      if (s.length < 25 || s.length > 400) continue
      if (OBLIGATION_RE.test(s)) {
        push({
          claimText: s, claimType: 'obligation', assertedBy: null,
          sourceObjectID: objectID, evidenceBlockIDs: [b.id],
          confidence: 0.75, extractionMethod: 'rule'
        })
      } else if (MONEY_RE.test(s)) {
        push({
          claimText: s, claimType: 'amount', assertedBy: null,
          sourceObjectID: objectID, evidenceBlockIDs: [b.id],
          confidence: 0.7, extractionMethod: 'rule'
        })
      } else if (parseDates(s, 1).length > 0) {
        push({
          claimText: s, claimType: 'date_assertion', assertedBy: null,
          sourceObjectID: objectID, evidenceBlockIDs: [b.id],
          confidence: 0.65, extractionMethod: 'rule'
        })
      }
      if (claims.length >= 60) return claims // per-document cap
    }
  }
  return claims
}
