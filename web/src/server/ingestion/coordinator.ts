//
// coordinator.ts — the ingest pipeline. Ported from Ingestion/Pipeline/
// IngestCoordinator.swift. For each file: detect → load → KnowledgeObject →
// chunk → enrich (entities/events/relationships) → embed → vectors → mark
// ingested. Emits live activity so the UI banner can show progress.
//

import { stat, readdir, readFile, mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, basename, extname } from 'node:path'
import type { Repos } from '../storage'
import type { CapabilityRegistry } from '../routing/capabilityRegistry'
import { detectSourceType } from './sourceType'
import { loadFile, type RawBlock } from './loaders'
import { chunk as chunkContent, chunkBlocks } from './chunker'
import { classify } from './classifier'
import { enrichObject } from '../knowledge/enrich'
import { extractClaims } from '../knowledge/claimExtractor'
import { recomputeFactStatus } from '../knowledge/factStatus'
import { newID } from '../core/ids'
import { log } from '../core/logger'
import { sourceCategory, type EvidenceBlock } from '../../shared/models'

const SUPPORTED_EXT = new Set([
  'pdf', 'docx', 'doc', 'txt', 'log', 'md', 'markdown', 'rtf', 'odt', 'epub',
  'csv', 'tsv', 'xlsx', 'xls', 'html', 'htm', 'json',
  'eml', 'emlx', 'mbox', 'msg', 'png', 'jpg', 'jpeg', 'zip'
])

export interface IngestActivityState {
  activeCount: number
  lastFile: string | null
}

export type ActivityListener = (state: IngestActivityState) => void

export class IngestCoordinator {
  private active = 0
  private lastFile: string | null = null
  private listeners = new Set<ActivityListener>()

  constructor(
    private repos: Repos,
    private capabilities: CapabilityRegistry
  ) {}

  onActivity(cb: ActivityListener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  get state(): IngestActivityState {
    return { activeCount: this.active, lastFile: this.lastFile }
  }

  private emit(): void {
    const s = this.state
    for (const l of this.listeners) l(s)
  }

  /** Expand any directories, then ingest each supported file. */
  async ingestPaths(paths: string[]): Promise<{ ingested: number; skipped: number }> {
    const files = await this.expand(paths)
    let ingested = 0
    let skipped = 0
    for (const f of files) {
      this.active++
      this.emit()
      try {
        const did = await this.ingestFile(f)
        if (did) ingested++
        else skipped++
        this.lastFile = basename(f)
      } catch (err) {
        log.ingestion.error(`ingest failed: ${f}`, err)
        skipped++
      } finally {
        this.active--
        this.emit()
      }
    }
    // Post-batch: recompute the Fact Status Matrix across the whole ledger —
    // corroboration and contradictions are cross-document by nature.
    if (ingested > 0) {
      try {
        await recomputeFactStatus(this.repos)
      } catch (err) {
        log.knowledge.warn(`fact status pass failed: ${String(err)}`)
      }
    }
    return { ingested, skipped }
  }

  private async expand(paths: string[]): Promise<string[]> {
    const out: string[] = []
    for (const p of paths) {
      try {
        const s = await stat(p)
        if (s.isDirectory()) {
          out.push(...(await this.walk(p)))
        } else if (SUPPORTED_EXT.has(extname(p).toLowerCase().replace('.', ''))) {
          out.push(p)
        }
      } catch (err) {
        log.ingestion.warn(`cannot stat ${p}: ${String(err)}`)
      }
    }
    return out
  }

  private async walk(dir: string, depth = 0): Promise<string[]> {
    if (depth > 6) return []
    const out: string[] = []
    let entries: import('node:fs').Dirent[] = []
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return out
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      const full = join(dir, e.name)
      if (e.isDirectory()) out.push(...(await this.walk(full, depth + 1)))
      else if (SUPPORTED_EXT.has(extname(e.name).toLowerCase().replace('.', ''))) out.push(full)
    }
    return out
  }

  /** Ingest one file through the evidence-ledger pipeline:
   *  parse → evidence blocks (+citations) → table rows → chunks → claims →
   *  entities/events → embeddings → run record. Returns false if skipped. */
  async ingestFile(path: string, depth = 0): Promise<boolean> {
    const sourceType = detectSourceType(path)
    const s = await stat(path)
    const existing = await this.repos.files.byURL(path)
    if (existing?.ingestedAt) return false // already ingested this path

    // Identity + exact-duplicate detection (spec steps 3–4): SHA-256 of the
    // original bytes. A duplicate becomes an alias row — parsed exactly once.
    const bytes = await readFile(path)
    const hash = createHash('sha256').update(bytes).digest('hex')
    const dup = await this.repos.files.byHash(hash)
    if (dup && dup.url !== path) {
      const alias = await this.repos.files.upsert({
        url: path, sourceType, sizeBytes: s.size, modifiedAt: s.mtimeMs,
        ingestedAt: null, contentHash: hash, availability: 'available', aliasOf: dup.id
      })
      await this.repos.files.markIngested(alias.id)
      const dupRun = await this.repos.ingestionRuns.start(alias.id, `parser.${sourceType}`)
      await this.repos.ingestionRuns.finish(dupRun, {
        status: 'duplicate', warnings: [`exact duplicate of ${basename(dup.url)} (same SHA-256)`]
      })
      log.ingestion(`dedup: ${basename(path)} is a duplicate of ${basename(dup.url)}`)
      return false
    }

    // ZIP archives: extract and recurse (depth-capped), preserving lineage.
    if (sourceType === 'zip' && depth < 3) {
      return this.ingestZip(path, hash, s.size, s.mtimeMs, depth)
    }

    const file = await this.repos.files.upsert({
      url: path, sourceType, sizeBytes: s.size, modifiedAt: s.mtimeMs,
      ingestedAt: null, contentHash: hash, availability: 'available'
    })
    const runID = await this.repos.ingestionRuns.start(file.id, `parser.${sourceType}`)
    const warnings: string[] = []
    let nBlocks = 0, nChunks = 0, nRows = 0, nClaims = 0, nEmbeddings = 0

    try {
      const docs = await loadFile(path, sourceType)
      const fname = basename(path)
      let needsOcr = false
      for (const doc of docs) {
        if (doc.metadata.unsupported) {
          // Honest non-extraction: nothing fabricated, nothing indexed.
          warnings.push(String(doc.metadata.note ?? 'unsupported format'))
          if (doc.metadata.unsupported === 'needs_ocr') needsOcr = true
          continue
        }
        if (!doc.content.trim()) continue
        const docClass = classify(doc.content, sourceType)
        const ko = await this.repos.objects.insert({
          fileID: file.id, sourceType, content: doc.content,
          metadata: { ...doc.metadata, docClass, category: sourceCategory(sourceType) },
          sourceFile: path, confidence: doc.metadata.stub ? 0.4 : 1.0
        })

        // Evidence blocks — the atomic, citable units of the ledger.
        const blocks: EvidenceBlock[] = doc.blocks.map((b, i) => ({
          id: newID(), objectID: ko.id, ordinal: i,
          blockType: b.blockType, text: b.text ?? null,
          structuredData: b.structuredData ?? {},
          page: b.page ?? null, sheet: b.sheet ?? null, rowNum: b.rowNum ?? null,
          charStart: b.charStart ?? null, charEnd: b.charEnd ?? null,
          sectionPath: b.sectionPath ?? [],
          citation: buildCitation(fname, b),
          extractionMethod: b.extractionMethod ?? 'native',
          extractionConfidence: b.extractionConfidence ?? 1.0,
          createdAt: Date.now()
        }))
        if (blocks.length) await this.repos.blocks.insertMany(blocks)
        nBlocks += blocks.length

        // Structured table rows — spreadsheets stay data, not prose.
        const rowBlocks = blocks.filter((b) => b.blockType === 'table_row')
        if (rowBlocks.length) {
          nRows += await this.repos.tableRows.insertMany(rowBlocks.map((b) => ({
            objectID: ko.id, sheet: b.sheet ?? null, rowNum: b.rowNum ?? 0,
            columns: Object.fromEntries(Object.entries(b.structuredData).map(([k, v]) => [k, String(v ?? '')]))
          })))
        }

        // Structure-aware chunks (fall back to char-window if no blocks).
        const chunks = blocks.length ? chunkBlocks(ko.id, doc.blocks) : chunkContent(ko.id, doc.content)
        if (chunks.length) await this.repos.chunks.insertMany(chunks)
        nChunks += chunks.length

        // Deterministic claims — the layer between evidence and events.
        nClaims += await this.repos.claims.insertMany(extractClaims(ko.id, blocks, doc.metadata))

        await enrichObject(this.repos, ko.id, doc.content, doc.metadata, s.mtimeMs)

        // Embeddings (best-effort; FTS still works without them).
        if (chunks.length) {
          try {
            const vecs = await this.capabilities.embedBatch(chunks.map((c) => c.contextPrefix ? `${c.contextPrefix}\n${c.text}` : c.text))
            if (vecs) {
              for (let i = 0; i < chunks.length && i < vecs.length; i++) {
                if (vecs[i]?.length) { await this.repos.vectors.put(chunks[i].id, vecs[i]); nEmbeddings++ }
              }
            }
          } catch (err) {
            warnings.push(`embeddings unavailable: ${String(err).slice(0, 120)}`)
            log.ingestion.warn(`embedding skipped for ${fname}: ${String(err)}`)
          }
        }
      }

      await this.repos.files.markIngested(file.id)
      const status = nBlocks > 0
        ? (warnings.length ? 'low_confidence' : 'indexed')
        : (needsOcr ? 'needs_ocr' : 'unsupported')
      await this.repos.ingestionRuns.finish(runID, {
        status, blocks: nBlocks, chunks: nChunks, tableRows: nRows, claims: nClaims,
        embeddings: nEmbeddings, warnings
      })
      return nBlocks > 0
    } catch (err) {
      await this.repos.ingestionRuns.finish(runID, {
        status: 'failed', blocks: nBlocks, chunks: nChunks, tableRows: nRows,
        claims: nClaims, embeddings: nEmbeddings, warnings: [...warnings, String(err).slice(0, 200)]
      })
      throw err
    }
  }

  /** Extract a ZIP and recursively ingest its supported entries. The archive
   *  itself gets a file row + run; children carry their own hashes. */
  private async ingestZip(path: string, hash: string, size: number, mtime: number, depth: number): Promise<boolean> {
    const file = await this.repos.files.upsert({
      url: path, sourceType: 'zip', sizeBytes: size, modifiedAt: mtime,
      ingestedAt: null, contentHash: hash, availability: 'available'
    })
    const runID = await this.repos.ingestionRuns.start(file.id, 'parser.zip')
    try {
      const AdmZip: any = (await import('adm-zip')).default
      const zip = new AdmZip(path)
      const outDir = await mkdtemp(join(tmpdir(), 'rch-zip-'))
      const extracted: string[] = []
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue
        const name = String(entry.entryName).replace(/\\/g, '/')
        if (name.includes('..')) continue // path traversal guard
        const ext = extname(name).toLowerCase().replace('.', '')
        if (!SUPPORTED_EXT.has(ext)) continue
        const target = join(outDir, name.replace(/\//g, '_'))
        await mkdir(join(outDir), { recursive: true })
        await writeFile(target, entry.getData())
        extracted.push(target)
        if (extracted.length >= 500) break
      }
      let ok = 0
      for (const child of extracted) {
        try { if (await this.ingestFile(child, depth + 1)) ok++ } catch (err) {
          log.ingestion.warn(`zip child failed: ${basename(child)}: ${String(err)}`)
        }
      }
      await this.repos.files.markIngested(file.id)
      await this.repos.ingestionRuns.finish(runID, {
        status: ok > 0 ? 'indexed' : 'unsupported',
        warnings: [`archive: ${extracted.length} supported entr${extracted.length === 1 ? 'y' : 'ies'}, ${ok} ingested`]
      })
      return ok > 0
    } catch (err) {
      await this.repos.ingestionRuns.finish(runID, { status: 'failed', warnings: [String(err).slice(0, 200)] })
      throw err
    }
  }
}

/** Human-readable citation anchor for a block. */
function buildCitation(filename: string, b: RawBlock): string {
  const parts: string[] = [filename]
  if (b.page != null) parts.push(`page ${b.page}`)
  if (b.sheet && b.rowNum != null) parts.push(`${b.sheet} row ${b.rowNum}`)
  else if (b.rowNum != null) parts.push(`row ${b.rowNum}`)
  if (b.sectionPath?.length) parts.push(b.sectionPath[b.sectionPath.length - 1])
  if (b.blockType === 'email_message') parts.push('email header')
  return parts.join(', ')
}
