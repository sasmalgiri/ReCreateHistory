//
// HistoryScreen — the evidence-ledger reconstruction surface. Four tabs:
// Timeline (every event status-tagged + source-linked), Evidence (claims with
// citations), Contradictions (the persisted conflict ledger), and Missing
// Proof (what the sources do NOT establish). Every item shows HOW it is known:
// observed / asserted / derived / inferred / contradicted — proven facts
// separated from inference, deterministically.
//

import { useState } from 'react'
import { BookOpen, CalendarClock, FileText, AlertTriangle, SearchX, CheckCircle2, XCircle, Download } from 'lucide-react'
import { km, useAsync } from '../lib/km'
import { PageHeader, Card, Badge, Spinner, EmptyState, Scroll, Meter, ErrorNote, Button } from '../components/ui'
import { fmtDate, fmtPct } from '../lib/format'
import type { KEvent, EpistemicStatus, LedgerClaim, UUID } from '../../../shared/models'
import type { FactMatrix } from '../../../shared/ipc'

type Tab = 'timeline' | 'evidence' | 'contradictions' | 'missing'

const STATUS_TONE: Record<EpistemicStatus, 'high' | 'medium' | 'low' | 'neutral' | 'accent'> = {
  observed: 'high', asserted: 'accent', derived: 'medium',
  inferred: 'medium', contradicted: 'low', unsupported: 'low'
}

async function exportReport(): Promise<void> {
  const { markdown } = await km.ledger.exportReport()
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `chronology-report-${new Date().toISOString().slice(0, 10)}.md`
  a.click()
  URL.revokeObjectURL(url)
}

export default function HistoryScreen(): JSX.Element {
  const [tab, setTab] = useState<Tab>('timeline')
  const matrix = useAsync(() => km.ledger.factMatrix(), [])

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={<BookOpen className="h-5 w-5" />}
        title="Reconstruction"
        subtitle="The evidence-backed version of events — every item labeled by how it is known, never averaged away."
        actions={<Button onClick={exportReport}><Download className="h-4 w-4" /> Export report</Button>}
      />
      <div className="border-b border-ink-800 px-6 pt-3">
        {matrix.data && <MatrixStrip m={matrix.data} />}
        <div className="mt-3 flex gap-1">
          {([
            ['timeline', 'Timeline', CalendarClock],
            ['evidence', 'Evidence', FileText],
            ['contradictions', 'Contradictions', AlertTriangle],
            ['missing', 'Missing Proof', SearchX]
          ] as [Tab, string, typeof CalendarClock][]).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 rounded-t-lg px-3 py-1.5 text-sm transition-colors ${
                tab === key ? 'bg-ink-900 text-accent-soft' : 'text-ink-500 hover:text-ink-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
              {key === 'contradictions' && (matrix.data?.contradictions ?? 0) > 0 && (
                <span className="rounded-full bg-rose-900/60 px-1.5 text-[10px] text-rose-300">{matrix.data!.contradictions}</span>
              )}
              {key === 'missing' && (matrix.data?.missingProof ?? 0) > 0 && (
                <span className="rounded-full bg-amber-900/60 px-1.5 text-[10px] text-amber-300">{matrix.data!.missingProof}</span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'timeline' && <TimelineTab onReviewed={matrix.reload} />}
        {tab === 'evidence' && <EvidenceTab />}
        {tab === 'contradictions' && <ContradictionsTab />}
        {tab === 'missing' && <MissingTab />}
      </div>
    </div>
  )
}

// ── Fact Status Matrix strip ────────────────────────────────────────────

function MatrixStrip({ m }: { m: FactMatrix }): JSX.Element {
  const cells: [string, number, string][] = [
    ['Observed', m.observed, 'text-emerald-300'],
    ['Asserted', m.asserted, 'text-accent-soft'],
    ['Derived', m.derived, 'text-amber-300'],
    ['Inferred', m.inferred, 'text-amber-400'],
    ['Contradicted', m.contradicted, 'text-rose-300'],
    ['Corroborated ×2+', m.corroborated, 'text-emerald-300']
  ]
  return (
    <div className="flex flex-wrap gap-4 text-xs">
      {cells.map(([label, n, cls]) => (
        <div key={label}>
          <span className={`text-base font-semibold tabular-nums ${cls}`}>{n}</span>
          <span className="ml-1 text-ink-500">{label}</span>
        </div>
      ))}
    </div>
  )
}

// ── Timeline tab — every event status-tagged + reviewable ───────────────

function TimelineTab({ onReviewed }: { onReviewed: () => void }): JSX.Element {
  const [status, setStatus] = useState<EpistemicStatus | ''>('')
  const events = useAsync(() => km.ledger.eventsByStatus(status || undefined, 300), [status])

  const byMonth = new Map<string, KEvent[]>()
  for (const e of events.data ?? []) {
    const key = new Date(e.date).toISOString().slice(0, 7)
    const arr = byMonth.get(key) ?? []
    arr.push(e)
    byMonth.set(key, arr)
  }
  const months = [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))

  return (
    <Scroll>
      <div className="mb-3 flex items-center gap-2">
        <select className="input w-48" value={status} onChange={(e) => setStatus(e.target.value as EpistemicStatus | '')}>
          <option value="">All statuses</option>
          {(['observed', 'asserted', 'derived', 'inferred', 'contradicted'] as EpistemicStatus[]).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <span className="text-xs text-ink-500">{events.data?.length ?? 0} events</span>
      </div>
      {events.loading ? <Spinner /> : events.error ? <ErrorNote message={events.error} /> : !months.length ? (
        <EmptyState icon={<CalendarClock className="h-8 w-8" />} title="No events reconstructed yet"
          hint="Ingest sources; the ledger extracts dated events and labels how each is known." />
      ) : (
        <div className="space-y-5">
          {months.map(([month, evs]) => (
            <div key={month}>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500">{month}</div>
              <div className="space-y-2">
                {evs.sort((a, b) => b.date - a.date).map((e) => <EventRow key={e.id} e={e} onReviewed={onReviewed} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </Scroll>
  )
}

function EventRow({ e, onReviewed }: { e: KEvent; onReviewed: () => void }): JSX.Element {
  const [review, setReview] = useState(e.reviewStatus)
  async function mark(s: 'accepted' | 'rejected'): Promise<void> {
    await km.ledger.reviewEvent(e.id, s)
    setReview(s)
    onReviewed()
  }
  return (
    <Card className={`p-3 ${review === 'rejected' ? 'opacity-50' : ''}`}>
      <div className="flex items-start gap-3">
        <div className="w-20 shrink-0 pt-0.5 text-xs tabular-nums text-ink-500">{fmtDate(e.date)}</div>
        <div className="min-w-0 flex-1">
          <div className="text-sm text-ink-100">{e.title}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[e.epistemicStatus]}>{e.epistemicStatus}</Badge>
            {e.corroborationCount >= 2 && <Badge tone="high">{e.corroborationCount} sources</Badge>}
            <span className="text-[11px] text-ink-600">date confidence {fmtPct(e.dateConfidence)}</span>
            {e.statusReason && <span className="truncate text-[11px] italic text-ink-600">— {e.statusReason}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 pt-0.5">
          {review === 'accepted' ? <Badge tone="high">accepted</Badge> : review === 'rejected' ? <Badge tone="low">rejected</Badge> : (
            <>
              <button type="button" title="Accept" className="text-ink-600 hover:text-emerald-400" onClick={() => mark('accepted')}>
                <CheckCircle2 className="h-4 w-4" />
              </button>
              <button type="button" title="Reject" className="text-ink-600 hover:text-rose-400" onClick={() => mark('rejected')}>
                <XCircle className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>
    </Card>
  )
}

// ── Evidence tab — the claims ledger with citations ─────────────────────

function EvidenceTab(): JSX.Element {
  const claims = useAsync(() => km.ledger.claims(undefined, 300), [])
  const runs = useAsync(() => km.ledger.ingestionRuns(20), [])
  const byType = new Map<string, LedgerClaim[]>()
  for (const c of claims.data ?? []) {
    const arr = byType.get(c.claimType) ?? []
    arr.push(c)
    byType.set(c.claimType, arr)
  }
  return (
    <Scroll>
      {claims.loading ? <Spinner /> : !claims.data?.length ? (
        <EmptyState icon={<FileText className="h-8 w-8" />} title="No claims extracted yet"
          hint="Claims are extracted deterministically at ingest: obligations, dates, amounts, communications." />
      ) : (
        <div className="space-y-4">
          {[...byType.entries()].map(([type, list]) => (
            <Card key={type} title={`${type.replace('_', ' ')} (${list.length})`}>
              <div className="space-y-2">
                {list.slice(0, 40).map((c) => (
                  <div key={c.id} className="rounded-md border border-ink-800 bg-ink-900/50 px-3 py-2">
                    <div className="text-sm text-ink-200">{c.claimText}</div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-ink-600">
                      {c.assertedBy && <span>asserted by {c.assertedBy}</span>}
                      <span className="shrink-0">confidence {fmtPct(c.confidence)}</span>
                      <div className="w-20"><Meter value={c.confidence} /></div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
          {runs.data && runs.data.length > 0 && (
            <Card title="Ingestion ledger">
              <div className="space-y-1 text-xs">
                {runs.data.map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded bg-ink-900/50 px-2 py-1">
                    <span className="text-ink-400">{r.parser}</span>
                    <span className="text-ink-600">{r.blocks} blocks · {r.chunks} chunks · {r.claims} claims{r.tableRows ? ` · ${r.tableRows} rows` : ''}</span>
                    <Badge tone={r.status === 'indexed' ? 'high' : r.status === 'failed' ? 'low' : 'medium'}>{r.status}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </Scroll>
  )
}

// ── Contradictions tab — the persisted conflict ledger ──────────────────

function ContradictionsTab(): JSX.Element {
  const list = useAsync(() => km.ledger.contradictions(), [])
  const [detail, setDetail] = useState<{ a: KEvent | null; b: KEvent | null; id: UUID } | null>(null)

  async function open(id: UUID): Promise<void> {
    const d = await km.ledger.contradictionDetail(id)
    setDetail({ a: d.a, b: d.b, id })
  }

  return (
    <Scroll>
      {list.loading ? <Spinner /> : !list.data?.length ? (
        <EmptyState icon={<AlertTriangle className="h-8 w-8" />} title="No contradictions detected"
          hint="When two sources state conflicting facts, both land here — shown, never averaged away." />
      ) : (
        <div className="space-y-2">
          {list.data.map((c) => (
            <Card key={c.id} className="p-3">
              <button type="button" className="w-full text-left" onClick={() => open(c.id)}>
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                  <div>
                    <div className="text-sm text-ink-100">{c.explanation}</div>
                    <div className="mt-1 flex gap-2 text-[11px] text-ink-600">
                      <Badge tone="low">{c.kind.replace('_', ' ')}</Badge>
                      <span>{c.resolutionStatus}</span>
                    </div>
                  </div>
                </div>
              </button>
              {detail?.id === c.id && (detail.a || detail.b) && (
                <div className="mt-3 grid gap-2 border-t border-ink-800 pt-2 sm:grid-cols-2">
                  {[detail.a, detail.b].map((e, i) => e && (
                    <div key={i} className="rounded bg-ink-900/60 px-2 py-1.5 text-xs">
                      <div className="text-ink-300">{e.title}</div>
                      <div className="mt-0.5 text-ink-600">{fmtDate(e.date)} · {e.epistemicStatus}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </Scroll>
  )
}

// ── Missing Proof tab — what the sources do NOT establish ───────────────

function MissingTab(): JSX.Element {
  const list = useAsync(() => km.ledger.missingProof(), [])
  return (
    <Scroll>
      {list.loading ? <Spinner /> : !list.data?.length ? (
        <EmptyState icon={<SearchX className="h-8 w-8" />} title="No evidence gaps flagged"
          hint="Single-source events, unfulfilled obligations, uncertain dates, and silent periods appear here." />
      ) : (
        <div className="space-y-2">
          {list.data.map((m, i) => (
            <Card key={i} className="p-3">
              <div className="flex items-start gap-2">
                <SearchX className={`mt-0.5 h-4 w-4 shrink-0 ${m.severity === 'warn' ? 'text-amber-400' : 'text-ink-500'}`} />
                <div>
                  <div className="text-sm text-ink-200">{m.description}</div>
                  <div className="mt-1"><Badge tone={m.severity === 'warn' ? 'medium' : 'neutral'}>{m.kind.replace(/_/g, ' ')}</Badge></div>
                </div>
              </div>
            </Card>
          ))}
          <div className="pt-1 text-xs text-ink-600">
            The reconstruction never guesses past your evidence — ingest more sources to close these gaps.
          </div>
        </div>
      )}
    </Scroll>
  )
}
