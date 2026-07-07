//
// SourcesScreen — ingest management. Add files or a folder root; the pipeline
// turns each into KnowledgeObjects → chunks → entities/events/vectors. Mirrors
// UI/SourcesView.swift + OnboardingView's folder picking.
//

import { FolderOpen, FilePlus, FolderPlus, RefreshCw, Trash2 } from 'lucide-react'
import { km, useAsync } from '../lib/km'
import { PageHeader, Button, Card, EmptyState, Badge, Spinner, Scroll } from '../components/ui'
import { fmtBytes, fmtRelative } from '../lib/format'
import { sourceCategory } from '../../../shared/models'
import { GuideBox } from '../components/guidance'

export default function SourcesScreen(): JSX.Element {
  const files = useAsync(() => km.ingest.listFiles(500), [])
  const roots = useAsync(() => km.ingest.roots(), [])

  async function addFiles(): Promise<void> {
    const picked = await km.ingest.pickFiles()
    if (picked.length) { await km.ingest.addPaths(picked); poll(files.reload) }
  }
  async function addFolder(): Promise<void> {
    const dir = await km.ingest.pickFolder()
    if (dir) { await km.ingest.addRoot(dir); roots.reload(); poll(files.reload) }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={<FolderOpen className="h-5 w-5" />}
        title="Sources"
        subtitle="Ingest anything in place — PDFs, docs, emails, spreadsheets, web pages. Nothing leaves your machine."
        actions={
          <>
            <Button onClick={addFiles}><FilePlus className="h-4 w-4" /> Add files</Button>
            <Button variant="primary" onClick={addFolder}><FolderPlus className="h-4 w-4" /> Add folder</Button>
          </>
        }
      />
      <Scroll>
        <GuideBox screen="sources" />
        <div className="space-y-4">
          {roots.data && roots.data.length > 0 && (
            <Card title="Watched roots">
              <div className="space-y-1">
                {roots.data.map((r) => (
                  <div key={r} className="flex items-center justify-between rounded-md bg-ink-900/60 px-3 py-1.5 text-xs">
                    <span className="truncate text-ink-300">{r}</span>
                    <button className="text-ink-500 hover:text-rose-400" onClick={() => km.ingest.removeRoot(r).then(roots.reload)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card title={`Files (${files.data?.length ?? 0})`} right={<Button onClick={files.reload}><RefreshCw className="h-3.5 w-3.5" /></Button>}>
            {files.loading ? <Spinner /> : !files.data?.length ? (
              <EmptyState icon={<FolderOpen className="h-8 w-8" />} title="No sources yet"
                hint="Add files or a folder to build your knowledge ledger."
                action={<Button variant="primary" onClick={addFolder}><FolderPlus className="h-4 w-4" /> Add folder</Button>} />
            ) : (
              <div className="divide-y divide-ink-800/60">
                {files.data.map((f) => (
                  <div key={f.id} className="flex items-center gap-3 py-2 text-sm">
                    <Badge tone="neutral">{sourceCategory(f.sourceType)}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-ink-200">{f.url.split(/[\\/]/).pop()}</div>
                      <div className="truncate text-xs text-ink-600">{f.url}</div>
                    </div>
                    <div className="shrink-0 text-right text-xs text-ink-500">
                      <div>{fmtBytes(f.sizeBytes)}</div>
                      <div>{f.ingestedAt ? `ingested ${fmtRelative(f.ingestedAt)}` : 'pending'}</div>
                    </div>
                    <button className="text-ink-500 hover:text-accent-soft" title="Re-ingest" onClick={() => km.ingest.reingest(f.id).then(() => poll(files.reload))}>
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                    <button className="text-ink-500 hover:text-rose-400" title="Remove" onClick={() => km.ingest.remove(f.id).then(files.reload)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </Scroll>
    </div>
  )
}

/** Ingest runs async in the main process; refresh the list a few times. */
function poll(reload: () => void): void {
  let n = 0
  const t = setInterval(() => { reload(); if (++n > 8) clearInterval(t) }, 1200)
}
