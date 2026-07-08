//
// loaders.ts — the universal parser layer. Every format-specific parser emits
// the SAME shape: clean text + metadata + structured EvidenceBlocks (paragraph,
// heading, table_row, email_message, …), each with its location anchor,
// extraction method, and confidence. Parsers extract evidence — they never
// summarize, never call an LLM, never interpret. Formats die here.
//
// Real: txt/md/log/rtf/csv/tsv/xlsx/xls/ods/html/json/pdf/docx/eml/mbox
// (+ ZIP recursion in the coordinator). Formats needing engines we don't
// bundle (image OCR, audio/video ASR, pst/nsf/legacy office) are recorded
// honestly as needs_ocr/unsupported — NOTHING fabricated is ever indexed.
//

import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { SourceType, BlockType, ExtractionMethod } from '../../shared/models'
import { sourceCategory } from '../../shared/models'
import { clean } from './cleaner'
import { tryTranscribe } from './asr'
import { tryOcr } from './ocr'
import { log } from '../core/logger'

/** Block as emitted by a parser — the coordinator assigns IDs + citations. */
export interface RawBlock {
  blockType: BlockType
  text?: string
  structuredData?: Record<string, unknown>
  page?: number
  sheet?: string
  rowNum?: number
  charStart?: number
  charEnd?: number
  sectionPath?: string[]
  extractionMethod?: ExtractionMethod
  extractionConfidence?: number
}

export interface LoadedDocument {
  content: string
  metadata: Record<string, unknown>
  blocks: RawBlock[]
}

export async function loadFile(path: string, sourceType: SourceType): Promise<LoadedDocument[]> {
  const cat = sourceCategory(sourceType)
  try {
    switch (sourceType) {
      case 'txt': case 'markdown': case 'rtf':
        return [await loadPlainText(path, sourceType === 'markdown')]
      case 'csv':
        return [await loadDelimited(path)]
      case 'xlsx': case 'xls': case 'ods':
        return [await loadWorkbook(path)]
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
      case 'pptx':
        return [await loadPptx(path)]
      case 'epub':
        return [await loadEpub(path)]
      case 'mp3': case 'wav': case 'm4a': case 'aac': case 'mp4': case 'mov':
        return [await loadAudio(path, sourceType)]
      case 'png': case 'jpg': case 'webp': case 'heic': case 'tiff':
        return [await loadImage(path, sourceType)]
      default:
        if (cat === 'image') return [unsupported('needs_ocr', 'this image format has no OCR support here — use PNG or JPG')]
        if (cat === 'audio') return [unsupported('unsupported', 'this audio format is not transcribable here — use MP3 or WAV')]
        if (cat === 'video') return [unsupported('unsupported', 'this video format is not transcribable here — use MP4')]
        if (cat === 'archive') return [unsupported('unsupported', `${sourceType} archives are not extractable (only ZIP is)`)]
        return [await loadPlainText(path, false)]
    }
  } catch (err) {
    log.ingestion.error(`loader failed for ${path}`, err)
    return [unsupported('unsupported', `could not read: ${String(err).slice(0, 160)}`)]
  }
}

/** Honest non-extraction: NO fabricated content ever enters the ledger.
 *  The coordinator records the file + run status; nothing is indexed. */
function unsupported(status: 'unsupported' | 'needs_ocr', note: string): LoadedDocument {
  return { content: '', metadata: { unsupported: status, note }, blocks: [] }
}

// ── Shared block builders ───────────────────────────────────────────────

/** Walk clean text into heading/paragraph blocks with char anchors. */
export function paragraphBlocks(content: string, opts?: { markdown?: boolean; page?: number }): RawBlock[] {
  const blocks: RawBlock[] = []
  const section: string[] = []
  let cursor = 0
  for (const para of content.split(/\n{2,}/)) {
    const text = para.trim()
    const start = content.indexOf(para, cursor)
    const end = start + para.length
    cursor = end
    if (!text) continue
    const isMdHeading = opts?.markdown && /^#{1,6}\s+\S/.test(text)
    // Heuristic heading: short single line, no terminal punctuation, title-ish.
    const isBareHeading = !text.includes('\n') && text.length <= 80 && !/[.!?:;,]$/.test(text) &&
      /^[A-Z0-9]/.test(text) && text.split(/\s+/).length <= 10
    if (isMdHeading || (isBareHeading && blocks.length > 0)) {
      const label = text.replace(/^#{1,6}\s+/, '')
      section.splice(0, section.length, label)
      blocks.push({
        blockType: 'heading', text: label, charStart: start, charEnd: end,
        sectionPath: [...section], page: opts?.page,
        extractionMethod: 'native', extractionConfidence: 1.0
      })
    } else {
      blocks.push({
        blockType: 'paragraph', text, charStart: start, charEnd: end,
        sectionPath: [...section], page: opts?.page,
        extractionMethod: 'native', extractionConfidence: 1.0
      })
    }
  }
  return blocks
}

// ── Text-family parsers ─────────────────────────────────────────────────

async function loadPlainText(path: string, markdown: boolean): Promise<LoadedDocument> {
  const raw = await readFile(path, 'utf8')
  const content = clean(stripRtf(raw))
  return { content, metadata: { filename: basename(path) }, blocks: paragraphBlocks(content, { markdown }) }
}

function stripRtf(s: string): string {
  if (!s.startsWith('{\\rtf')) return s
  return s.replace(/\\[a-z]+-?\d* ?/g, '').replace(/[{}]/g, '').trim()
}

// ── Spreadsheet / delimited parser — rows stay STRUCTURED ───────────────

async function loadDelimited(path: string): Promise<LoadedDocument> {
  const raw = await readFile(path, 'utf8').catch(() => '')
  if (!raw) return unsupported('unsupported', 'empty or unreadable delimited file')
  const delim = raw.slice(0, 2000).includes('\t') ? '\t' : ','
  const lines = raw.split(/\r?\n/).filter((l) => l.trim()).slice(0, 5000)
  if (!lines.length) return unsupported('unsupported', 'empty spreadsheet')
  const headers = splitRow(lines[0], delim)
  const blocks: RawBlock[] = []
  const textLines: string[] = [lines[0]]
  for (let i = 1; i < lines.length; i++) {
    const cells = splitRow(lines[i], delim)
    const columns: Record<string, unknown> = {}
    headers.forEach((h, k) => { columns[h || `col${k + 1}`] = cells[k] ?? '' })
    const rowText = headers.map((h, k) => `${h || `col${k + 1}`}=${cells[k] ?? ''}`).join('; ')
    blocks.push({
      blockType: 'table_row', text: rowText, structuredData: columns, rowNum: i + 1,
      sheet: basename(path), extractionMethod: 'native', extractionConfidence: 1.0
    })
    textLines.push(rowText)
  }
  return {
    content: clean(textLines.join('\n')),
    metadata: { filename: basename(path), rows: lines.length - 1, headers },
    blocks
  }
}

function splitRow(line: string, delim: string): string[] {
  // Minimal CSV: handles quoted cells with embedded delimiters.
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { inQ = !inQ; continue }
    if (ch === delim && !inQ) { out.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  out.push(cur.trim())
  return out
}


// ── Binary workbooks (XLSX/XLS/ODS) — real parsing via SheetJS ──────────

async function loadWorkbook(path: string): Promise<LoadedDocument> {
  const XLSX: any = await import('xlsx')
  const buf = await readFile(path)
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false })
  const blocks: RawBlock[] = []
  const textLines: string[] = []
  let totalRows = 0
  for (const sheetName of wb.SheetNames as string[]) {
    const sheet = wb.Sheets[sheetName]
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })
    if (!rows.length) continue
    const headers = (rows[0] as unknown[]).map((h, i) => String(h ?? '').trim() || `col${i + 1}`)
    for (let r = 1; r < rows.length && totalRows < 20000; r++) {
      const cells = rows[r] as unknown[]
      if (!cells.some((c) => String(c ?? '').trim())) continue
      const columns: Record<string, unknown> = {}
      headers.forEach((h, k) => { columns[h] = String(cells[k] ?? '') })
      const rowText = headers.map((h, k) => `${h}=${String(cells[k] ?? '')}`).join('; ')
      blocks.push({
        blockType: 'table_row', text: rowText, structuredData: columns,
        rowNum: r + 1, sheet: sheetName, extractionMethod: 'native', extractionConfidence: 1.0
      })
      textLines.push(`[${sheetName}] ${rowText}`)
      totalRows++
    }
  }
  if (!blocks.length) return unsupported('unsupported', 'workbook has no data rows')
  return {
    content: clean(textLines.join('\n')),
    metadata: { filename: basename(path), sheets: wb.SheetNames.length, rows: totalRows },
    blocks
  }
}

// ── HTML / JSON ─────────────────────────────────────────────────────────

async function loadHtml(path: string): Promise<LoadedDocument> {
  const raw = await readFile(path, 'utf8')
  const title = raw.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim()
  const text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(h[1-6]|p|div|li|tr|br)[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  const content = clean(text)
  return { content, metadata: { filename: basename(path), title }, blocks: paragraphBlocks(content) }
}

async function loadJson(path: string): Promise<LoadedDocument> {
  const raw = await readFile(path, 'utf8')
  try {
    const obj = JSON.parse(raw)
    const content = clean(JSON.stringify(obj, null, 1))
    return { content, metadata: { filename: basename(path), json: true }, blocks: paragraphBlocks(content) }
  } catch {
    const content = clean(raw)
    return { content, metadata: { filename: basename(path) }, blocks: paragraphBlocks(content) }
  }
}

// ── PDF / DOCX ──────────────────────────────────────────────────────────

async function loadPdf(path: string): Promise<LoadedDocument> {
  try {
    const mod: any = await import('pdf-parse')
    const pdfParse = mod.default ?? mod
    const buf = await readFile(path)
    const data = await pdfParse(buf)
    const content = clean(data.text ?? '')
    if (!content) return unsupported('needs_ocr', 'PDF has no text layer — OCR engine not installed')
    // pdf-parse flattens pages; per-page anchors are a follow-on (needs pdfjs).
    return {
      content,
      metadata: { filename: basename(path), pages: data.numpages, pageAnchors: false },
      blocks: paragraphBlocks(content)
    }
  } catch (err) {
    return unsupported('unsupported', `PDF text extraction failed (${String(err).slice(0, 140).replace(/\s+/g, ' ')})`)
  }
}

async function loadDocx(path: string): Promise<LoadedDocument> {
  try {
    const mod: any = await import('mammoth')
    const buf = await readFile(path)
    const res = await mod.extractRawText({ buffer: buf })
    const content = clean(res.value ?? '')
    return { content, metadata: { filename: basename(path) }, blocks: paragraphBlocks(content) }
  } catch (err) {
    return unsupported('unsupported', `DOCX extraction failed (${String(err).slice(0, 140)})`)
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

function emailDocument(e: ParsedEmail, filename: string): LoadedDocument {
  const content = clean(
    `Subject: ${e.subject ?? '(no subject)'}\nFrom: ${e.from ?? ''}\nTo: ${e.to ?? ''}\nDate: ${e.date ?? ''}\n\n${e.body}`
  )
  // The header block is OBSERVED evidence (structured source, highest trust).
  const headerBlock: RawBlock = {
    blockType: 'email_message',
    text: `${e.subject ?? '(no subject)'} — from ${e.from ?? 'unknown'} to ${e.to ?? 'unknown'} on ${e.date ?? 'unknown date'}`,
    structuredData: { from: e.from, to: e.to, cc: e.cc, subject: e.subject, date: e.date },
    extractionMethod: 'native', extractionConfidence: 0.98
  }
  return {
    content,
    metadata: { filename, from: e.from, to: e.to, cc: e.cc, subject: e.subject, date: e.date, isEmail: true },
    blocks: [headerBlock, ...paragraphBlocks(e.body)]
  }
}

async function loadEml(path: string): Promise<LoadedDocument> {
  const raw = await readFile(path, 'utf8')
  return emailDocument(parseEmail(raw), basename(path))
}

async function loadMbox(path: string): Promise<LoadedDocument[]> {
  const raw = await readFile(path, 'utf8')
  const parts = raw.split(/\r?\n(?=From )/).filter((p) => p.trim())
  const out: LoadedDocument[] = []
  for (const part of parts.slice(0, 5000)) {
    const e = parseEmail(part.replace(/^From .*\r?\n/, ''))
    if (!e.subject && !e.from && !e.body) continue
    out.push(emailDocument(e, basename(path)))
  }
  if (out.length) return out
  const content = clean(raw)
  return [{ content, metadata: { filename: basename(path) }, blocks: paragraphBlocks(content) }]
}

// ── PPTX — slides are ZIP'd XML; text lives in <a:t> runs ───────────────

async function loadPptx(path: string): Promise<LoadedDocument> {
  const AdmZip: any = (await import('adm-zip')).default
  const zip = new AdmZip(path)
  const slides: { n: number; text: string }[] = []
  for (const e of zip.getEntries()) {
    const m = String(e.entryName).match(/^ppt\/slides\/slide(\d+)\.xml$/)
    if (!m) continue
    const xml = e.getData().toString('utf8')
    const runs = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((r) => r[1])
    const text = clean(runs.join(' '))
    if (text) slides.push({ n: Number(m[1]), text })
  }
  if (!slides.length) return unsupported('unsupported', 'presentation has no extractable text')
  slides.sort((a, b) => a.n - b.n)
  const blocks: RawBlock[] = slides.map((sl) => ({
    blockType: 'slide', text: sl.text, page: sl.n,
    sectionPath: [`Slide ${sl.n}`], extractionMethod: 'native', extractionConfidence: 1.0
  }))
  return {
    content: clean(slides.map((sl) => `Slide ${sl.n}: ${sl.text}`).join('\n\n')),
    metadata: { filename: basename(path), slides: slides.length },
    blocks
  }
}

// ── EPUB — chapters are ZIP'd XHTML ─────────────────────────────────────

async function loadEpub(path: string): Promise<LoadedDocument> {
  const AdmZip: any = (await import('adm-zip')).default
  const zip = new AdmZip(path)
  const chapters: { name: string; text: string }[] = []
  const entries = zip.getEntries()
    .filter((e: any) => /\.(xhtml|html|htm)$/i.test(e.entryName) && !/(toc|nav|cover)/i.test(e.entryName))
    .sort((a: any, b: any) => String(a.entryName).localeCompare(String(b.entryName), undefined, { numeric: true }))
  for (const e of entries.slice(0, 300)) {
    const html = e.getData().toString('utf8')
    const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim()
    const text = clean(html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<(h[1-6]|p|div|li|br)[^>]*>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
    if (text.length > 40) chapters.push({ name: title || basename(String(e.entryName)), text })
  }
  if (!chapters.length) return unsupported('unsupported', 'no readable chapters found in this EPUB')
  const blocks: RawBlock[] = []
  for (const ch of chapters) {
    blocks.push({ blockType: 'heading', text: ch.name, sectionPath: [ch.name], extractionMethod: 'native', extractionConfidence: 1.0 })
    for (const b of paragraphBlocks(ch.text)) blocks.push({ ...b, sectionPath: [ch.name] })
  }
  return {
    content: clean(chapters.map((c) => `${c.name}\n\n${c.text}`).join('\n\n')),
    metadata: { filename: basename(path), chapters: chapters.length },
    blocks
  }
}

// ── Audio — transcribed by the configured AI (see ./asr); honest when off ──

async function loadAudio(path: string, format: string): Promise<LoadedDocument> {
  const transcript = await tryTranscribe(path, format)
  if (!transcript) {
    return unsupported('unsupported', 'audio transcription needs the AI provider (not configured or file too large)')
  }
  const blocks: RawBlock[] = [
    { blockType: 'audio_transcript', text: `Transcript of ${basename(path)}`, extractionMethod: 'asr', extractionConfidence: 0.85, sectionPath: ['Transcript'] },
    ...paragraphBlocks(transcript).map((b) => ({ ...b, extractionMethod: 'asr' as const, extractionConfidence: 0.85 }))
  ]
  return {
    content: clean(transcript),
    metadata: { filename: basename(path), transcribed: true, asr: true },
    blocks
  }
}

// ── Images — OCR via the per-app engine (desktop: local Tesseract; web:
// Gemini vision). Honest needs_ocr when no engine can read it. ─────────────

async function loadImage(path: string, ext: string): Promise<LoadedDocument> {
  const raw = await tryOcr(path, ext)
  if (!raw) {
    return unsupported('needs_ocr', 'no readable text extracted (blank image, unsupported format, engine unavailable, or file too large)')
  }
  // Tables in scans arrive as ===TABLE=== TSV sections (web/Gemini path; plain
  // Tesseract text simply has no markers). Rows become STRUCTURED evidence —
  // same table_rows store the CSV/XLSX parsers feed.
  const [prose, ...tableSections] = raw.split(/^\s*===TABLE===\s*$/m)
  const blocks: RawBlock[] = paragraphBlocks(clean(prose)).map((b) => ({
    ...b, blockType: b.blockType === 'heading' ? 'heading' : 'ocr_text',
    extractionMethod: 'ocr' as const, extractionConfidence: 0.8
  }))
  const textLines: string[] = prose.trim() ? [clean(prose)] : []
  let rowNum = 0
  for (const section of tableSections) {
    const lines = section.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.includes('\t'))
    if (lines.length < 2) continue
    const headers = lines[0].split('\t').map((h, i) => h.trim() || `col${i + 1}`)
    for (let r = 1; r < lines.length; r++) {
      const cells = lines[r].split('\t')
      const columns: Record<string, unknown> = {}
      headers.forEach((h, k) => { columns[h] = (cells[k] ?? '').trim() })
      const rowText = headers.map((h, k) => `${h}=${(cells[k] ?? '').trim()}`).join('; ')
      blocks.push({
        blockType: 'table_row', text: rowText, structuredData: columns,
        rowNum: ++rowNum, sheet: basename(path),
        extractionMethod: 'ocr', extractionConfidence: 0.75
      })
      textLines.push(rowText)
    }
  }
  return {
    content: clean(textLines.join('\n')),
    metadata: { filename: basename(path), ocr: true, tables: tableSections.length },
    blocks
  }
}
