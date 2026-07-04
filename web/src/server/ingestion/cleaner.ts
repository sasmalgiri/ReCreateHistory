//
// cleaner.ts — normalizes extracted text before it becomes a KnowledgeObject.
// Ported from Ingestion/Cleaning/Cleaner.swift (simplified). Formats die at
// ingestion; everything downstream sees clean text.
//

export function clean(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/ /g, ' ') // non-breaking space -> normal space
    .replace(/[​-‏﻿]/g, '') // zero-width chars + BOM
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/** Strip quoted reply chains from email bodies (keep the top-most message). */
export function stripQuotedReplies(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  for (const line of lines) {
    if (/^\s*>/.test(line)) continue
    if (/^\s*On .* wrote:\s*$/.test(line)) break
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line)) break
    out.push(line)
  }
  return out.join('\n').trim()
}
