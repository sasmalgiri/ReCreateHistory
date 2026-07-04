//
// dateGrammar.ts — parse dates out of text with a precision flag. Ported from
// Knowledge/Temporal/DateGrammar.swift. Precision travels WITH the timestamp —
// never pad a month-only date to midnight and forget the precision.
//

import { DatePrecision } from '../../shared/models'

export interface ParsedDate {
  ms: number
  precision: DatePrecision
  surface: string
  index: number
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
}

export function parseDates(text: string, max = 12): ParsedDate[] {
  const found: ParsedDate[] = []
  const push = (ms: number, precision: DatePrecision, surface: string, index: number): void => {
    if (Number.isFinite(ms)) found.push({ ms, precision, surface, index })
  }

  // ISO 8601: 2025-03-14 or 2025-03-14T09:00
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?\b/g)) {
    const [, y, mo, d, h, mi] = m
    const ms = Date.UTC(+y, +mo - 1, +d, h ? +h : 0, mi ? +mi : 0)
    push(ms, h ? DatePrecision.minute : DatePrecision.day, m[0], m.index ?? 0)
  }
  // Month DD, YYYY  (March 14, 2025 / Mar 14 2025)
  for (const m of text.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g)) {
    const mo = MONTHS[m[1].toLowerCase()]
    if (mo === undefined) continue
    push(Date.UTC(+m[3], mo, +m[2]), DatePrecision.day, m[0], m.index ?? 0)
  }
  // DD Month YYYY (14 March 2025)
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b/g)) {
    const mo = MONTHS[m[2].toLowerCase()]
    if (mo === undefined) continue
    push(Date.UTC(+m[3], mo, +m[1]), DatePrecision.day, m[0], m.index ?? 0)
  }
  // Numeric DD/MM/YYYY or MM/DD/YYYY (assume DD/MM if first > 12)
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g)) {
    let a = +m[1], b = +m[2]
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    let day = a, mo = b
    if (a > 12) { day = a; mo = b } else { day = a; mo = b } // ambiguous; keep MM/DD default swap below
    // Heuristic: if first > 12 it must be the day.
    if (a > 12) { day = a; mo = b } else { mo = a; day = b }
    if (mo < 1 || mo > 12) continue
    push(Date.UTC(y, mo - 1, day), DatePrecision.day, m[0], m.index ?? 0)
  }
  // Month YYYY (March 2025) — month precision
  for (const m of text.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{4})\b/g)) {
    const mo = MONTHS[m[1].toLowerCase()]
    if (mo === undefined) continue
    push(Date.UTC(+m[2], mo, 1), DatePrecision.month, m[0], m.index ?? 0)
  }
  // Bare year — year precision (only when few other dates found)
  if (found.length < 3) {
    for (const m of text.matchAll(/\b(19|20)\d{2}\b/g)) {
      push(Date.UTC(+m[0], 0, 1), DatePrecision.year, m[0], m.index ?? 0)
    }
  }

  // Dedup by ms, keep highest precision, sort by position.
  const byMs = new Map<number, ParsedDate>()
  for (const d of found) {
    const prev = byMs.get(d.ms)
    if (!prev || d.precision > prev.precision) byMs.set(d.ms, d)
  }
  return [...byMs.values()].sort((a, b) => a.index - b.index).slice(0, max)
}

/** Parse an RFC-2822 style email Date header. */
export function parseEmailDate(header?: string): number | null {
  if (!header) return null
  const t = Date.parse(header)
  return Number.isFinite(t) ? t : null
}
