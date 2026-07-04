//
// LibraryScreen — browse the ledger. Three tabs over the knowledge store:
// Documents (KnowledgeObjects with a content preview), Summaries (grouped by
// level), and Memories (distilled per-subject state). Mirrors UI/LibraryView.swift
// as the "book index" surface, adapted to the win port's knowledge inventory.
//

import { useMemo, useState } from 'react'
import { BookOpen, FileText, ScrollText, Brain, RefreshCw } from 'lucide-react'
import { km, useAsync } from '../lib/km'
import { PageHeader, Card, Button, Badge, Spinner, EmptyState, Scroll, ErrorNote, Meter } from '../components/ui'
import { fmtRelative, fmtDateTime, titleCase, confidenceLabel, fmtPct } from '../lib/format'
import type { KnowledgeObject, Summary, MemoryObject, SummaryLevel, UUID } from '../../../shared/models'

type Tab = 'documents' | 'summaries' | 'memories'

const TABS: { id: Tab; label: string; icon: JSX.Element }[] = [
  { id: 'documents', label: 'Documents', icon: <FileText className="h-3.5 w-3.5" /> },
  { id: 'summaries', label: 'Summaries', icon: <ScrollText className="h-3.5 w-3.5" /> },
  { id: 'memories', label: 'Memories', icon: <Brain className="h-3.5 w-3.5" /> }
]

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

export default function LibraryScreen(): JSX.Element {
  const [tab, setTab] = useState<Tab>('documents')

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={<BookOpen className="h-5 w-5" />}
        title="Library"
        subtitle="Browse the ledger — the normalized documents, distilled summaries, and long-term memory built from your archive."
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-ink-800 bg-ink-900/60 p-0.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ' +
                  (tab === t.id ? 'bg-ink-800 text-ink-100' : 'text-ink-500 hover:text-ink-300')
                }
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        }
      />
      <Scroll>
        {tab === 'documents' && <DocumentsTab />}
        {tab === 'summaries' && <SummariesTab />}
        {tab === 'memories' && <MemoriesTab />}
      </Scroll>
    </div>
  )
}

// ── Documents ─────────────────────────────────────────────────────────────

function DocumentsTab(): JSX.Element {
  const objects = useAsync<KnowledgeObject[]>(() => km.knowledge.objects(200), [])
  const [selected, setSelected] = useState<UUID | null>(null)
  const preview = useAsync<KnowledgeObject | null>(
    () => (selected ? km.knowledge.objectContent(selected) : Promise.resolve(null)),
    [selected]
  )

  if (objects.loading) return <Spinner label="Loading documents…" />
  if (objects.error) return <ErrorNote message={objects.error} />
  if (!objects.data?.length) {
    return (
      <EmptyState
        icon={<FileText className="h-8 w-8" />}
        title="No documents yet"
        hint="Ingest files from the Sources tab to normalize them into the ledger."
      />
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={`Documents (${objects.data.length})`} right={<Button onClick={objects.reload}><RefreshCw className="h-3.5 w-3.5" /></Button>}>
        <div className="divide-y divide-ink-800/60">
          {objects.data.map((o) => (
            <button
              key={o.id}
              onClick={() => setSelected(o.id)}
              className={
                'flex w-full items-center gap-3 py-2 text-left text-sm transition-colors ' +
                (selected === o.id ? 'text-accent-soft' : 'text-ink-200 hover:text-ink-100')
              }
            >
              <Badge tone={selected === o.id ? 'accent' : 'neutral'}>{o.sourceType}</Badge>
              <div className="min-w-0 flex-1">
                <div className="truncate">{fileName(o.sourceFile)}</div>
                <div className="truncate text-xs text-ink-600">{o.sourceFile}</div>
              </div>
              <span className="shrink-0 text-xs text-ink-500">{fmtRelative(o.createdAt)}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card title="Preview">
        {!selected ? (
          <EmptyState icon={<FileText className="h-8 w-8" />} title="Select a document" hint="Pick a document on the left to read its normalized content." />
        ) : preview.loading ? (
          <Spinner label="Loading content…" />
        ) : preview.error ? (
          <ErrorNote message={preview.error} />
        ) : !preview.data ? (
          <EmptyState icon={<FileText className="h-8 w-8" />} title="Content unavailable" hint="This document has no stored content." />
        ) : (
          <DocumentPreview object={preview.data} />
        )}
      </Card>
    </div>
  )
}

const PREVIEW_LIMIT = 20_000

function DocumentPreview({ object }: { object: KnowledgeObject }): JSX.Element {
  const truncated = object.content.length > PREVIEW_LIMIT
  const body = truncated ? object.content.slice(0, PREVIEW_LIMIT) : object.content
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
        <Badge tone="neutral">{object.sourceType}</Badge>
        <span className="truncate">{fileName(object.sourceFile)}</span>
        <span>· {fmtDateTime(object.createdAt)}</span>
      </div>
      <div className="max-h-[60vh] overflow-y-auto rounded-md border border-ink-800 bg-ink-950/60 p-3">
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-ink-300">{body}</pre>
        {truncated && <div className="mt-2 text-xs text-ink-600">…content truncated ({fmtPct(PREVIEW_LIMIT / object.content.length)} shown).</div>}
      </div>
    </div>
  )
}

// ── Summaries ─────────────────────────────────────────────────────────────

function SummariesTab(): JSX.Element {
  const summaries = useAsync<Summary[]>(() => km.knowledge.summaries(), [])

  const groups = useMemo(() => {
    const map = new Map<SummaryLevel, Summary[]>()
    for (const s of summaries.data ?? []) {
      const arr = map.get(s.level) ?? []
      arr.push(s)
      map.set(s.level, arr)
    }
    return Array.from(map.entries())
  }, [summaries.data])

  if (summaries.loading) return <Spinner label="Loading summaries…" />
  if (summaries.error) return <ErrorNote message={summaries.error} />
  if (!groups.length) {
    return (
      <EmptyState
        icon={<ScrollText className="h-8 w-8" />}
        title="No summaries yet"
        hint="Summaries form once the summarizer has run over your ingested documents."
      />
    )
  }

  return (
    <div className="space-y-4">
      {groups.map(([level, items]) => (
        <Card key={level} title={`${titleCase(level)} (${items.length})`}>
          <div className="space-y-3">
            {items.map((s) => (
              <div key={s.id} className="rounded-md border border-ink-800 bg-ink-900/40 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs text-ink-500">
                  <Badge tone="accent">{s.length}</Badge>
                  <span>{fmtDateTime(s.producedAt)}</span>
                  {s.modelID && <span className="text-ink-600">· {s.modelID}</span>}
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-300">{s.body}</p>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}

// ── Memories ──────────────────────────────────────────────────────────────

function MemoriesTab(): JSX.Element {
  const memories = useAsync<MemoryObject[]>(() => km.knowledge.memories(), [])

  if (memories.loading) return <Spinner label="Loading memories…" />
  if (memories.error) return <ErrorNote message={memories.error} />
  if (!memories.data?.length) {
    return (
      <EmptyState
        icon={<Brain className="h-8 w-8" />}
        title="No memories yet"
        hint="Memory objects distill the durable state of each project, person, and topic as the ledger grows."
      />
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {memories.data.map((m) => {
        const conf = confidenceLabel(m.confidence)
        return (
          <Card key={m.id}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <Badge tone="neutral">{titleCase(m.subjectKind)}</Badge>
              {m.status && <span className="text-xs text-ink-500">{m.status}</span>}
            </div>
            <h3 className="text-base font-semibold text-ink-100">{m.subjectIdentifier}</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-300">{m.narrative}</p>
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-ink-500">
                <span>Confidence · {conf.label}</span>
                <span className="tabular-nums">{fmtPct(m.confidence)}</span>
              </div>
              <Meter value={m.confidence} tone={conf.tone} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-ink-500">
              <span>{m.keyEventIDs.length} key events</span>
              <span>· updated {fmtRelative(m.updatedAt)}</span>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
