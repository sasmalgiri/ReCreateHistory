//
// SourcesScreen (web) — ingest management via browser upload. Upload documents
// (PDF, docx, email, csv, html, txt…) and the pipeline turns each into
// KnowledgeObjects → chunks → entities/events/vectors in your private ledger.
//

import { useState } from 'react'
import { FolderOpen, Upload, RefreshCw, Trash2 } from 'lucide-react'
import { km, useAsync, uploadAndIngest } from '../lib/km'
import { PageHeader, Button, Card, EmptyState, Badge, Spinner, Scroll } from '../components/ui'
import { fmtBytes, fmtRelative } from '../lib/format'
import { sourceCategory } from '../../../shared/models'
import { GuideBox } from '../components/guidance'

export default function SourcesScreen(): JSX.Element {
  const files = useAsync(() => km.ingest.listFiles(500), [])
  const [uploading, setUploading] = useState(false)

  async function upload(): Promise<void> {
    setUploading(true)
    try {
      const n = await uploadAndIngest()
      if (n > 0) poll(files.reload)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={<FolderOpen className="h-5 w-5" />}
        title="Sources"
        subtitle="Upload your documents, emails, and spreadsheets. They become a structured, searchable ledger — private to your account."
        actions={
          <Button variant="primary" onClick={upload} disabled={uploading}>
            <Upload className="h-4 w-4" /> {uploading ? 'Uploading…' : 'Upload files'}
          </Button>
        }
      />
      <Scroll>
        <GuideBox screen="sources" />
        <Card title={`Files (${files.data?.length ?? 0})`} right={<Button onClick={files.reload}><RefreshCw className="h-3.5 w-3.5" /></Button>}>
          {files.loading ? <Spinner /> : !files.data?.length ? (
            <EmptyState
              icon={<Upload className="h-8 w-8" />}
              title="No sources yet"
              hint="Upload PDFs, Word docs, emails (.eml/.mbox), spreadsheets, HTML, or text to build your knowledge ledger."
              action={<Button variant="primary" onClick={upload}><Upload className="h-4 w-4" /> Upload files</Button>}
            />
          ) : (
            <div className="divide-y divide-ink-800/60">
              {files.data.map((f) => (
                <div key={f.id} className="flex items-center gap-3 py-2 text-sm">
                  <Badge tone="neutral">{sourceCategory(f.sourceType)}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-ink-200">{f.url.split(/[\\/]/).pop()}</div>
                    <div className="text-xs text-ink-600">{f.sourceType}</div>
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
      </Scroll>
    </div>
  )
}

/** Ingest runs async on the server; refresh the list a few times. */
function poll(reload: () => void): void {
  let n = 0
  const t = setInterval(() => { reload(); if (++n > 10) clearInterval(t) }, 1400)
}
