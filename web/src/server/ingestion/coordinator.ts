//
// coordinator.ts — the ingest pipeline. Ported from Ingestion/Pipeline/
// IngestCoordinator.swift. For each file: detect → load → KnowledgeObject →
// chunk → enrich (entities/events/relationships) → embed → vectors → mark
// ingested. Emits live activity so the UI banner can show progress.
//

import { stat, readdir } from 'node:fs/promises'
import { join, basename, extname } from 'node:path'
import type { Repos } from '../storage'
import type { CapabilityRegistry } from '../routing/capabilityRegistry'
import { detectSourceType } from './sourceType'
import { loadFile } from './loaders'
import { chunk as chunkContent } from './chunker'
import { classify } from './classifier'
import { enrichObject } from '../knowledge/enrich'
import { log } from '../core/logger'
import { sourceCategory } from '../../shared/models'

const SUPPORTED_EXT = new Set([
  'pdf', 'docx', 'doc', 'txt', 'log', 'md', 'markdown', 'rtf', 'odt', 'epub',
  'csv', 'tsv', 'xlsx', 'xls', 'html', 'htm', 'json',
  'eml', 'emlx', 'mbox', 'msg', 'png', 'jpg', 'jpeg'
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

  /** Ingest one file. Returns false if it was skipped (already ingested). */
  async ingestFile(path: string): Promise<boolean> {
    const sourceType = detectSourceType(path)
    const s = await stat(path)
    const existing = this.repos.files.byURL(path)
    if (existing?.ingestedAt) return false // already ingested this path

    const file = this.repos.files.upsert({
      url: path, sourceType, sizeBytes: s.size, modifiedAt: s.mtimeMs,
      ingestedAt: null, contentHash: null, availability: 'available'
    })

    const docs = await loadFile(path, sourceType)
    for (const doc of docs) {
      if (!doc.content.trim()) continue
      const docClass = classify(doc.content, sourceType)
      const ko = this.repos.objects.insert({
        fileID: file.id, sourceType, content: doc.content,
        metadata: { ...doc.metadata, docClass, category: sourceCategory(sourceType) },
        sourceFile: path, confidence: doc.metadata.stub ? 0.4 : 1.0
      })

      const chunks = chunkContent(ko.id, doc.content)
      if (chunks.length) this.repos.chunks.insertMany(chunks)

      enrichObject(this.repos, ko.id, doc.content, doc.metadata, s.mtimeMs)

      // Embeddings (best-effort; FTS still works without them).
      if (chunks.length) {
        try {
          const vecs = await this.capabilities.embedBatch(chunks.map((c) => c.contextPrefix ? `${c.contextPrefix}\n${c.text}` : c.text))
          if (vecs) {
            for (let i = 0; i < chunks.length && i < vecs.length; i++) {
              if (vecs[i]?.length) this.repos.vectors.put(chunks[i].id, vecs[i])
            }
          }
        } catch (err) {
          log.ingestion.warn(`embedding skipped for ${basename(path)}: ${String(err)}`)
        }
      }
    }

    this.repos.files.markIngested(file.id)
    return true
  }
}
