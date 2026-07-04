//
// CompletenessScreen — data-health / coverage checklist. Ports the intent of
// UI/CompletenessView.swift (spot silent ingest gaps at a glance) onto the win
// bridge: gathers the ledger inventory, the file list, and the timeline, then
// grades each coverage dimension ok / warn / missing with a hint on how to fix.
//

import { useMemo } from 'react'
import { ClipboardCheck, RefreshCw, CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react'
import { km, useAsync } from '../lib/km'
import { PageHeader, Card, Button, Badge, Spinner, EmptyState, Meter, ErrorNote } from '../components/ui'
import { fmtNum } from '../lib/format'
import type { KnowledgeInventory } from '../../../shared/ipc'
import type { FileRow, KEvent } from '../../../shared/models'

type CheckTone = 'high' | 'medium' | 'low'

interface Check {
  label: string
  tone: CheckTone
  count: number
  hint: string
  /** Boolean checks feed the overall completeness meter; info rows don't. */
  scored: boolean
  pass: boolean
}

const STATUS: Record<CheckTone, { badge: string; icon: JSX.Element }> = {
  high: { badge: 'ok', icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" /> },
  medium: { badge: 'warn', icon: <AlertTriangle className="h-4 w-4 text-amber-400" /> },
  low: { badge: 'missing', icon: <XCircle className="h-4 w-4 text-rose-400" /> }
}

function buildChecks(inv: KnowledgeInventory, files: FileRow[], events: KEvent[]): Check[] {
  const pending = files.filter((f: FileRow) => !f.ingestedAt).length
  const lowDates = events.filter((e: KEvent) => e.dateConfidence < 0.5).length

  const bool = (
    label: string,
    ok: boolean,
    count: number,
    okHint: string,
    failHint: string,
    failTone: CheckTone = 'low'
  ): Check => ({
    label,
    tone: ok ? 'high' : failTone,
    count,
    hint: ok ? okHint : failHint,
    scored: true,
    pass: ok
  })

  return [
    bool('Sources ingested', inv.files > 0, inv.files,
      'Files are in the ledger.', 'Add files or a folder on the Sources screen.'),
    bool('Text indexed (chunks)', inv.chunks > 0, inv.chunks,
      'Content is chunked and searchable.', 'No chunks yet — ingest hasn’t parsed any text.'),
    bool('Entities extracted', inv.entities > 0, inv.entities,
      'People, orgs and dates were recognized.', 'No entities yet — extraction hasn’t run.'),
    bool('Events on timeline', inv.events > 0, inv.events,
      'Dated events populate the timeline.', 'No events yet — nothing to place on the timeline.'),
    bool('Semantic search ready (vectors)', inv.vectors > 0, inv.vectors,
      'Embeddings enable meaning-based search.',
      'No vectors — pull an Ollama embedding model in Settings.', 'medium'),
    bool('Memories distilled', inv.memories > 0, inv.memories,
      'Per-subject memory has been distilled.',
      'No memories yet — distillation runs in the background.', 'medium'),
    {
      label: 'Files pending ingest',
      tone: pending === 0 ? 'high' : 'medium',
      count: pending,
      hint: pending === 0 ? 'Every file has been processed.' : 'These files are queued or mid-ingest.',
      scored: true,
      pass: pending === 0
    },
    {
      label: 'Low-confidence event dates',
      tone: lowDates === 0 ? 'high' : 'medium',
      count: lowDates,
      hint: lowDates === 0
        ? 'All event dates are well-grounded.'
        : 'Dates inferred from file mtime or body text — treat with care.',
      scored: false,
      pass: lowDates === 0
    }
  ]
}

function CheckRow({ check }: { check: Check }): JSX.Element {
  const status = STATUS[check.tone]
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="mt-0.5 shrink-0">{status.icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink-200">{check.label}</span>
          {!check.scored && (
            <span className="inline-flex items-center gap-1 text-xs text-ink-600">
              <Info className="h-3 w-3" /> info
            </span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-ink-500">{check.hint}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-sm font-semibold tabular-nums text-ink-100">{fmtNum(check.count)}</span>
        <Badge tone={check.tone}>{status.badge}</Badge>
      </div>
    </div>
  )
}

export default function CompletenessScreen(): JSX.Element {
  const inventory = useAsync(() => km.app.inventory(), [])
  const files = useAsync(() => km.ingest.listFiles(500), [])
  const events = useAsync(() => km.knowledge.events(500), [])

  const loading = inventory.loading || files.loading || events.loading
  const error = inventory.error ?? files.error ?? events.error
  const ready = Boolean(inventory.data && files.data && events.data)

  const checks = useMemo<Check[]>(() => {
    if (!inventory.data || !files.data || !events.data) return []
    return buildChecks(inventory.data, files.data, events.data)
  }, [inventory.data, files.data, events.data])

  const scored = checks.filter((c: Check) => c.scored)
  const passing = scored.filter((c: Check) => c.pass).length
  const fraction = scored.length ? passing / scored.length : 0
  const meterTone: 'high' | 'medium' | 'low' = fraction >= 0.75 ? 'high' : fraction >= 0.45 ? 'medium' : 'low'

  const reloadAll = (): void => { inventory.reload(); files.reload(); events.reload() }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={<ClipboardCheck className="h-5 w-5" />}
        title="Completeness"
        subtitle="Coverage checklist for your knowledge ledger — spot silent ingest gaps at a glance."
        actions={<Button onClick={reloadAll}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>}
      />
      <div className="h-full overflow-y-auto px-6 py-5">
        {loading && !ready ? (
          <Spinner label="Grading coverage…" />
        ) : error ? (
          <ErrorNote message={error} />
        ) : !ready ? (
          <EmptyState
            icon={<ClipboardCheck className="h-8 w-8" />}
            title="Nothing to grade yet"
            hint="Add sources so the ledger has something to measure."
          />
        ) : (
          <div className="mx-auto max-w-2xl space-y-4">
            <Card title="Overall completeness" right={
              <span className="text-sm font-semibold tabular-nums text-ink-100">
                {passing}/{scored.length}
              </span>
            }>
              <Meter value={fraction} tone={meterTone} />
              <div className="mt-2 text-xs text-ink-500">
                {passing} of {scored.length} coverage checks passing.
              </div>
            </Card>

            <Card title="Checks">
              <div className="divide-y divide-ink-800/60">
                {checks.map((c: Check) => <CheckRow key={c.label} check={c} />)}
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
