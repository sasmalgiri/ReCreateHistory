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

  // 2. Body-text dated events (T2).
  const dates = parseDates(content, 8)
  for (const d of dates) {
    const ctxStart = Math.max(0, d.index - 80)
    const ctxEnd = Math.min(content.length, d.index + 120)
    const ctx = content.slice(ctxStart, ctxEnd).replace(/\s+/g, ' ').trim()
    out.push({
      kind: kindForContext(ctx),
      date: d.ms,
      title: firstSentence(ctx) || `Event on ${new Date(d.ms).toISOString().slice(0, 10)}`,
      summary: ctx,
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

function firstSentence(s: string): string {
  const m = s.match(/[^.!?]{8,140}[.!?]?/)
  return (m?.[0] ?? s).trim().slice(0, 140)
}
