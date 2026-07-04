//
// entityExtractor.ts — the noun layer. Ported from Knowledge/Entities/
// EntityExtractor.swift + EntityQualityGate + QualityTierClassifier. Regex/
// heuristic NER (no NLTagger on Windows) with quality tiering:
//   T1 = structured header-derived (email From/To/Cc)
//   T2 = body-text extraction
//   T3 = shape-flagged noise (preserved, demoted at retrieval)
//

import type { EntityKind, QualityTier } from '../../shared/models'

export interface ExtractedEntity {
  kind: EntityKind
  value: string
  normalized: string
  confidence: number
  qualityTier: QualityTier
}

const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g
const PHONE_RE = /(?:(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{2,4})?)/g
const MONEY_RE = /(?:[$€£₹]\s?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s?(?:USD|EUR|GBP|INR|dollars?|rupees?|euros?)\b)/gi
const ORG_SUFFIX_RE = /\b([A-Z][A-Za-z0-9&.,'-]+(?:\s+[A-Z][A-Za-z0-9&.,'-]+){0,4})\s+(Inc|LLC|Ltd|Limited|Corp|Corporation|Company|Co|GmbH|LLP|PLC|Pvt|Group|Partners|Associates|Technologies|Solutions|Systems|Foundation|University|Institute)\b\.?/g
const INVOICE_RE = /\binvoice\s*(?:no\.?|number|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,})/gi
const PERSON_RE = /\b([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)\b/g

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

function looksLikeNoise(value: string): boolean {
  if (/^[^aeiou]{5,}$/i.test(value.replace(/\s/g, ''))) return true // vowel-less run
  if (/^[a-z0-9]{20,}$/i.test(value)) return true // base64-ish blob
  if (/^[A-Z]{2,}[a-z]+[A-Z]/.test(value)) return true // mid-cap camel run
  if (/\.(com|org|net|io|co)\b/i.test(value) && !value.includes('@')) return true // hostname-looking
  return false
}

export function extractEntities(content: string, opts?: {
  emailHeaders?: { from?: string; to?: string; cc?: string }
}): ExtractedEntity[] {
  const seen = new Map<string, ExtractedEntity>()
  const add = (kind: EntityKind, value: string, confidence: number, tier: QualityTier): void => {
    const v = value.trim()
    if (v.length < 2 || v.length > 120) return
    const key = `${kind}:${normalize(v)}`
    const finalTier: QualityTier = tier === 'T2' && looksLikeNoise(v) ? 'T3' : tier
    const existing = seen.get(key)
    if (!existing || tierRank(finalTier) < tierRank(existing.qualityTier)) {
      seen.set(key, { kind, value: v, normalized: normalize(v), confidence, qualityTier: finalTier })
    }
  }

  // T1 — structured email header entities (highest trust).
  if (opts?.emailHeaders) {
    for (const field of ['from', 'to', 'cc'] as const) {
      const raw = opts.emailHeaders[field]
      if (!raw) continue
      for (const m of raw.matchAll(EMAIL_RE)) add('emailAddress', m[0], 0.95, 'T1')
      // Display names before <email>
      for (const m of raw.matchAll(/([A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+)+)\s*<[^>]+>/g)) {
        add('person', m[1], 0.85, 'T1')
      }
    }
  }

  // T2 — body extraction.
  for (const m of content.matchAll(EMAIL_RE)) add('emailAddress', m[0], 0.8, 'T2')
  for (const m of content.matchAll(MONEY_RE)) add('money', m[0], 0.75, 'T2')
  for (const m of content.matchAll(ORG_SUFFIX_RE)) add('organization', m[0].replace(/\.$/, ''), 0.7, 'T2')
  for (const m of content.matchAll(INVOICE_RE)) add('invoiceNumber', m[1], 0.7, 'T2')
  for (const m of content.matchAll(PHONE_RE)) {
    const digits = m[0].replace(/\D/g, '')
    if (digits.length >= 9 && digits.length <= 14) add('phoneNumber', m[0].trim(), 0.6, 'T2')
  }
  for (const m of content.matchAll(PERSON_RE)) add('person', m[1], 0.5, 'T2')

  // Org from email domains (affiliation signal).
  for (const m of content.matchAll(EMAIL_RE)) {
    const domain = m[0].split('@')[1]
    if (domain && !/(gmail|outlook|yahoo|hotmail|icloud|proton|live|aol)\./i.test(domain)) {
      const stem = domain.split('.')[0]
      if (stem.length > 2) add('organization', stem, 0.55, 'T2')
    }
  }

  return [...seen.values()]
}

function tierRank(t: QualityTier): number {
  return t === 'T1' ? 0 : t === 'T2' ? 1 : 2
}
