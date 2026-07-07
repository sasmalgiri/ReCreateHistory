//
// eventExtractor.ts — the verb layer that drives the Timeline. Ported from
// Knowledge/Events/EventExtractor.swift. Events come from three sources with
// decreasing date confidence: email headers (0.95), body-text dates (0.7),
// file mtime fallback (0.3).
//

import type { EventKind, QualityTier } from '../../shared/models'
import { DatePrecision } from '../../shared/models'
import { parseDates, parseEmailDate } from './dateGrammar'

export interface ExtractedEvent {
  kind: EventKind
  date: number
  title: string
  summary?: string
  confidence: number
  dateConfidence: number
  qualityTier: QualityTier
  datePrecision: DatePrecision
}

function kindForContext(ctx: string): EventKind {
  const t = ctx.toLowerCase()
  if (/\binvoice\b|\bbilled\b/.test(t)) return 'invoiceIssued'
  if (/\bpaid\b|\bpayment (received|made)\b/.test(t)) return 'invoicePaid'
  if (/\bsigned\b|\bexecuted\b|\bcontract\b|\bagreement\b/.test(t)) return 'contractSigned'
  if (/\bamend|\brevis|\bmodif/.test(t)) return 'contractModified'
  if (/\bmeeting\b|\bcall\b|\bmet with\b/.test(t)) return 'meetingHeld'
  if (/\bassign|\btask\b|\baction item\b/.test(t)) return 'taskAssigned'
  if (/\bdelay|\bslip|\bpostpon|\boverdue\b/.test(t)) return 'deliveryDelayed'
  if (/\bdeliver|\bshipped|\bcompleted\b|\blaunched\b/.test(t)) return 'deliveryCompleted'
  return 'other'
}

export function extractEvents(content: string, opts: {
  isEmail?: boolean
  emailDate?: string
  emailSubject?: string
  emailFrom?: string
  fileModifiedAt: number
}): ExtractedEvent[] {
  const out: ExtractedEvent[] = []

  // 1. Email header event (T1, high date confidence).
  if (opts.isEmail) {
    const ms = parseEmailDate(opts.emailDate) ?? opts.fileModifiedAt
    out.push({
      kind: 'emailReceived',
      date: ms,
      title: opts.emailSubject ? `Email: ${opts.emailSubject}` : 'Email received',
      summary: opts.emailFrom ? `From ${opts.emailFrom}` : undefined,
      confidence: 0.85,
      dateConfidence: opts.emailDate ? 0.95 : 0.3,
      qualityTier: 'T1',
      datePrecision: opts.emailDate ? DatePrecision.minute : DatePrecision.day
    })
  }

  // 2. Body-text dated events (T2). The title is the FULL sentence containing
  // the date — snapped to real sentence/word boundaries so answers never show
  // mid-word fragments like "d to May 2025".
  const dates = parseDates(content, 8)
  for (const d of dates) {
    const sentence = sentenceAround(content, d.index)
    const ctx = sentence || content.slice(Math.max(0, d.index - 80), d.index + 120).replace(/\s+/g, ' ').trim()
    out.push({
      kind: kindForContext(ctx),
      date: d.ms,
      title: (sentence || `Event on ${new Date(d.ms).toISOString().slice(0, 10)}`).slice(0, 180),
      summary: ctx.slice(0, 280),
      confidence: 0.6,
      dateConfidence: 0.7,
      qualityTier: 'T2',
      datePrecision: d.precision
    })
  }

  // 3. mtime fallback so every document lands SOMEWHERE on the timeline.
  if (out.length === 0) {
    out.push({
      kind: 'other',
      date: opts.fileModifiedAt,
      title: 'Document ingested',
      confidence: 0.4,
      dateConfidence: 0.3,
      qualityTier: 'T2',
      datePrecision: DatePrecision.day
    })
  }

  return out
}

/** The complete sentence containing `index`, bounded to sane length. Falls
 *  back to a word-boundary-snapped window when no sentence markers exist. */
function sentenceAround(content: string, index: number): string {
  const windowStart = Math.max(0, index - 300)
  const windowEnd = Math.min(content.length, index + 300)
  const before = content.slice(windowStart, index)
  const after = content.slice(index, windowEnd)

  // Sentence start: after the last ".!?"+space or blank line before the date.
  // Single newlines are hard line-wraps in most documents, NOT sentence ends.
  const sm = before.match(/[\s\S]*(?:[.!?]\s+|\n{2,})/)
  const start = sm ? windowStart + sm[0].length : windowStart
  // Sentence end: at the first ".!?" (followed by space/end) or blank line.
  const em = after.match(/[.!?](?=\s|$)|\n{2,}/)
  const end = em && em.index !== undefined
    ? index + em.index + (em[0].length === 1 ? 1 : 0)
    : windowEnd

  let s = content.slice(start, end).replace(/\s+/g, ' ').trim()
  // If we hit the raw window edge (no boundary found), snap partial words off.
  if (start === windowStart && windowStart > 0) s = s.replace(/^\S*\s+/, '')
  if (end === windowEnd && windowEnd < content.length) s = s.replace(/\s+\S*$/, '')
  return s.length >= 12 ? s : ''
}
