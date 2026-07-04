//
// loaders.ts — turn a file on disk into one or more LoadedDocuments (clean
// text + metadata). Ported from Ingestion/Loaders/*. Formats die here: every
// loader emits the same LoadedDocument shape, so nothing downstream branches
// on file type.
//
// Real: txt/md/log/csv/tsv/html/json/pdf/docx/eml/mbox.
// Stubbed (clearly marked): images (OCR), audio/video (ASR), legacy office,
// archives, pst/msg — these need native engines and are follow-on work, but
// the dispatch slot exists so the pipeline never crashes on them.
//

import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { SourceType } from '../../shared/models'
import { sourceCategory } from '../../shared/models'
import { clean } from './cleaner'
import { log } from '../core/logger'

export interface LoadedDocument {
  content: string
  metadata: Record<string, unknown>
}

export async function loadFile(path: string, sourceType: SourceType): Promise<LoadedDocument[]> {
  const cat = sourceCategory(sourceType)
  try {
    switch (sourceType) {
      case 'txt': case 'markdown': case 'rtf':
        return [await loadPlainText(path)]
      case 'csv': case 'ods': case 'xls': case 'xlsx':
        return [await loadDelimited(path)]
      case 'html':
        return [await loadHtml(path)]
      case 'json':
        return [await loadJson(path)]
      case 'pdf':
        return [await loadPdf(path)]
      case 'docx':
        return [await loadDocx(path)]
      case 'eml': case 'appleMail': case 'msg':
        return [await loadEml(path)]
      case 'mbox':
        return await loadMbox(path)
      default:
        if (cat === 'image') return [stub(path, 'image OCR not wired on Windows yet (add a local OCR engine)')]
        if (cat === 'audio' || cat === 'video') return [stub(path, 'audio/video transcription (ASR) is a follow-on')]
        if (cat === 'archive') return [stub(path, 'archive extraction is a follow-on')]
        // Best effort: try to read as UTF-8 text.
        return [await loadPlainText(path)]
    }
  } catch (err) {
    log.ingestion.error(`loader failed for ${path}`, err)
    return [stub(path, `could not read: ${String(err)}`)]
  }
}

function stub(path: string, note: string): LoadedDocument {
  return { content: `[${basename(path)}] — ${note}`, metadata: { stub: true, note } }
}

async function loadPlainText(path: string): Promise<LoadedDocument> {
  const raw = await readFile(path, 'utf8')
  return { content: clean(stripRtf(raw)), metadata: { filename: basename(path) } }
}

function stripRtf(s: string): string {
  if (!s.startsWith('{\\rtf')) return s
  return s.replace(/\\[a-z]+-?\d* ?/g, '').replace(/[{}]/g, '').trim()
}

async function loadDelimited(path: string): Promise<LoadedDocument> {
  // Real for csv/tsv; xls/xlsx binary isn't parsed here (follow-on) — we try
  // UTF-8 and fall back to a stub if it's clearly binary.
  const raw = await readFile(path, 'utf8').catch(() => '')
  if (!raw || /�/.test(raw.slice(0, 200))) {
    return stub(path, 'binary spreadsheet parsing (xls/xlsx) is a follow-on')
  }
  const rows = raw.split(/\r?\n/).slice(0, 5000)
  const text = rows.join('\n')
  return { content: clean(text), metadata: { filename: basename(path), rows: rows.length } }
}

async function loadHtml(path: string): Promise<LoadedDocument> {
  const raw = await readFile(path, 'utf8')
  const title = raw.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim()
  const text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
  return { content: clean(text), metadata: { filename: basename(path), title } }
}

async function loadJson(path: string): Promise<LoadedDocument> {
  const raw = await readFile(path, 'utf8')
  try {
    const obj = JSON.parse(raw)
    return { content: clean(JSON.stringify(obj, null, 1)), metadata: { filename: basename(path), json: true } }
  } catch {
    return { content: clean(raw), metadata: { filename: basename(path) } }
  }
}

async function loadPdf(path: string): Promise<LoadedDocument> {
  try {
    // pdf-parse is CJS; import lazily so a missing/incompatible build doesn't
    // break the whole app.
    const mod: any = await import('pdf-parse')
    const pdfParse = mod.default ?? mod
    const buf = await readFile(path)
    const data = await pdfParse(buf)
    return { content: clean(data.text ?? ''), metadata: { filename: basename(path), pages: data.numpages } }
  } catch (err) {
    return stub(path, `PDF text extraction failed (${String(err)})`)
  }
}

async function loadDocx(path: string): Promise<LoadedDocument> {
  try {
    const mod: any = await import('mammoth')
    const buf = await readFile(path)
    const res = await mod.extractRawText({ buffer: buf })
    return { content: clean(res.value ?? ''), metadata: { filename: basename(path) } }
  } catch (err) {
    return stub(path, `DOCX extraction failed (${String(err)})`)
  }
}

// ── Email ───────────────────────────────────────────────────────────────

export interface ParsedEmail {
  from?: string
  to?: string
  cc?: string
  subject?: string
  date?: string
  body: string
}

export function parseEmail(raw: string): ParsedEmail {
  const sepIdx = raw.search(/\r?\n\r?\n/)
  const headerBlock = sepIdx >= 0 ? raw.slice(0, sepIdx) : raw
  const body = sepIdx >= 0 ? raw.slice(sepIdx).trim() : ''
  const headers: Record<string, string> = {}
  // Unfold headers (continuation lines start with whitespace).
  const unfolded = headerBlock.replace(/\r?\n[ \t]+/g, ' ')
  for (const line of unfolded.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z-]+):\s*(.*)$/)
    if (m) headers[m[1].toLowerCase()] = m[2].trim()
  }
  return {
    from: headers['from'], to: headers['to'], cc: headers['cc'],
    subject: headers['subject'], date: headers['date'], body: clean(body)
  }
}

async function loadEml(path: string): Promise<LoadedDocument> {
  const raw = await readFile(path, 'utf8')
  const e = parseEmail(raw)
  const content = clean(
    `Subject: ${e.subject ?? '(no subject)'}\nFrom: ${e.from ?? ''}\nTo: ${e.to ?? ''}\nDate: ${e.date ?? ''}\n\n${e.body}`
  )
  return { content, metadata: { filename: basename(path), from: e.from, to: e.to, subject: e.subject, date: e.date, isEmail: true } }
}

async function loadMbox(path: string): Promise<LoadedDocument[]> {
  const raw = await readFile(path, 'utf8')
  // Split on "From " at line start (mbox message boundary).
  const parts = raw.split(/\r?\n(?=From )/).filter((p) => p.trim())
  const out: LoadedDocument[] = []
  for (const part of parts.slice(0, 5000)) {
    const e = parseEmail(part.replace(/^From .*\r?\n/, ''))
    if (!e.subject && !e.from && !e.body) continue
    out.push({
      content: clean(`Subject: ${e.subject ?? '(no subject)'}\nFrom: ${e.from ?? ''}\nTo: ${e.to ?? ''}\nDate: ${e.date ?? ''}\n\n${e.body}`),
      metadata: { filename: basename(path), from: e.from, to: e.to, subject: e.subject, date: e.date, isEmail: true }
    })
  }
  return out.length ? out : [{ content: clean(raw), metadata: { filename: basename(path) } }]
}
