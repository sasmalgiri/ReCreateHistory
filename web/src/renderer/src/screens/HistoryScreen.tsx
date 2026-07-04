//
// HistoryScreen — historical reconstruction. Ported (and simplified for the
// Windows web port) from UI/HistoryView.swift. The user asks a reconstructive
// question and the brain returns a VerifiedAnswer whose prose is the narrative
// woven from the dated ledger. Below, the raw ledger is shown as "chapters" —
// recent dated events grouped by year — so the user sees the source material
// the story is written from. Turning the ledger into a narrative is the point.
//

import { useState } from 'react'
import { BookOpen, ScrollText, Send, FileText, ShieldOff, CalendarClock } from 'lucide-react'
import { km, useAsync } from '../lib/km'
import { PageHeader, Card, Button, Textarea, Badge, Spinner, EmptyState, Scroll, ErrorNote } from '../components/ui'
import { QualityStrip } from '../components/QualityStrip'
import { fmtDate } from '../lib/format'
import type { VerifiedAnswer, Citation } from '../../../shared/ai'
import type { KEvent } from '../../../shared/models'

const SUGGESTIONS: string[] = [
  'Reconstruct the history of Project Delta',
  'What happened with Supplier ABC?',
  'Reconstruct my correspondence with Khurana'
]

export default function HistoryScreen(): JSX.Element {
  const [question, setQuestion] = useState<string>('')
  const [answer, setAnswer] = useState<VerifiedAnswer | null>(null)
  const [composing, setComposing] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  // The ledger as context: recent dated events, grouped into year "chapters".
  const events = useAsync<KEvent[]>(() => km.knowledge.events(40), [])

  async function reconstruct(q?: string): Promise<void> {
    const trimmed = (q ?? question).trim()
    if (!trimmed || composing) return
    setQuestion(trimmed)
    setComposing(true)
    setError(null)
    setAnswer(null)
    try {
      const a = await km.ask.ask(trimmed)
      setAnswer(a)
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e))
    } finally {
      setComposing(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void reconstruct()
    }
  }

  const yearChapters = groupByYear(events.data ?? [])

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={<BookOpen className="h-5 w-5" />}
        title="History"
        subtitle="Turn the ledger into a narrative. Ask for the story of a project, person, or topic — every chapter is grounded in the dated events that produced it."
        actions={composing ? <Spinner label="Composing…" /> : undefined}
      />
      <Scroll>
        <div className="space-y-4">
          <Card>
            <div className="space-y-3">
              <Textarea
                rows={3}
                value={question}
                placeholder="Reconstruct the history of…"
                disabled={composing}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={onKeyDown}
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-ink-600">Cmd/Ctrl + Enter to reconstruct</span>
                <Button variant="primary" disabled={composing || !question.trim()} onClick={() => void reconstruct()}>
                  <Send className="h-4 w-4" /> Reconstruct
                </Button>
              </div>
              {!answer && !composing && !error && (
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      className="rounded-md border border-ink-800 bg-ink-900/50 px-2.5 py-1 text-xs text-ink-300 hover:border-accent/40 hover:text-accent-soft"
                      onClick={() => void reconstruct(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {error && <ErrorNote message={error} />}

          {composing && !answer && (
            <Card><Spinner label="Weaving the ledger into a history…" /></Card>
          )}

          {answer && answer.refused && (
            <Card>
              <div className="flex items-start gap-3">
                <ShieldOff className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
                <div>
                  <div className="text-sm font-semibold text-ink-200">History withheld</div>
                  <p className="mt-1 text-sm text-ink-400">
                    {answer.refusalReason ?? 'The evidence was too thin to reconstruct this history honestly.'}
                  </p>
                </div>
              </div>
            </Card>
          )}

          {answer && !answer.refused && (
            <>
              <Card title="The reconstruction">
                <div className="space-y-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-200">
                  {answer.body || <span className="text-ink-500">(no narrative produced)</span>}
                </div>
              </Card>

              <QualityStrip answer={answer} />

              <Card title={`Citations (${answer.citations.length})`}>
                {answer.citations.length === 0 ? (
                  <div className="text-sm text-ink-500">No source citations were attached to this history.</div>
                ) : (
                  <div className="space-y-2">
                    {answer.citations.map((c: Citation, i: number) => (
                      <div key={`${c.objectID}-${i}`} className="rounded-md border border-ink-800 bg-ink-900/50 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Badge tone="neutral"><FileText className="h-3 w-3" /> {c.objectID.slice(0, 8)}</Badge>
                          {c.eventID && (
                            <Badge tone="accent"><CalendarClock className="h-3 w-3" /> event {c.eventID.slice(0, 8)}</Badge>
                          )}
                        </div>
                        <p className="mt-1.5 text-sm text-ink-300">{c.snippet}</p>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </>
          )}

          <div className="pt-2">
            <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-wide text-ink-500">
              <ScrollText className="h-3.5 w-3.5" /> The ledger, as chapters
            </div>
            {events.loading ? (
              <Spinner label="Reading the timeline…" />
            ) : events.error ? (
              <ErrorNote message={events.error} />
            ) : yearChapters.length === 0 ? (
              <EmptyState
                icon={<BookOpen className="h-8 w-8" />}
                title="No dated events yet"
                hint="Ingest sources so the ledger has events to weave into a history."
              />
            ) : (
              <div className="space-y-4">
                {yearChapters.map((chapter) => (
                  <Card key={chapter.year} title={chapter.year} right={<Badge tone="neutral">{chapter.events.length} events</Badge>}>
                    <div className="divide-y divide-ink-800/60">
                      {chapter.events.map((ev) => (
                        <div key={ev.id} className="flex items-start gap-3 py-2 text-sm">
                          <span className="shrink-0 tabular-nums text-xs text-ink-500">{fmtDate(ev.date)}</span>
                          <span className="min-w-0 flex-1 text-ink-200">{ev.title}</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </Scroll>
    </div>
  )
}

interface YearChapter {
  year: string
  events: KEvent[]
}

/** Group dated events into descending-year "chapters", newest first. */
function groupByYear(events: KEvent[]): YearChapter[] {
  const byYear = new Map<string, KEvent[]>()
  for (const ev of events) {
    const d = new Date(ev.date)
    const year = Number.isNaN(d.getTime()) ? 'Undated' : String(d.getUTCFullYear())
    const bucket = byYear.get(year)
    if (bucket) bucket.push(ev)
    else byYear.set(year, [ev])
  }
  const chapters: YearChapter[] = Array.from(byYear.entries()).map(([year, evs]) => ({
    year,
    events: evs.slice().sort((a, b) => b.date - a.date)
  }))
  chapters.sort((a, b) => {
    if (a.year === 'Undated') return 1
    if (b.year === 'Undated') return -1
    return Number(b.year) - Number(a.year)
  })
  return chapters
}
