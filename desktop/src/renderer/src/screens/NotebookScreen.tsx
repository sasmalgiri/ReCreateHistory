//
// NotebookScreen — Plan-and-Solve investigations. Mirrors UI/NotebookView.swift.
// Left column lists past investigations and runs new ones; the right pane shows
// the original question, per-step sub-answers with confidence, and the synthesis.
//

import { useMemo, useState } from 'react'
import { Notebook, Sparkles, Trash2, Play, ArrowLeft } from 'lucide-react'
import { km, useAsync } from '../lib/km'
import {
  PageHeader, Card, Button, Input, Badge, Spinner, EmptyState, StatTile, Scroll, ErrorNote, Meter
} from '../components/ui'
import { fmtDateTime, fmtNum, fmtPct, confidenceLabel } from '../lib/format'
import type { Investigation, InvestigationStep } from '../../../shared/ipc'
import type { UUID } from '../../../shared/models'

export default function NotebookScreen(): JSX.Element {
  const list = useAsync<Investigation[]>(() => km.notebook.list(), [])
  const [selectedID, setSelectedID] = useState<UUID | null>(null)
  const [question, setQuestion] = useState('')
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  const investigations = list.data ?? []
  const selected = useMemo(
    () => investigations.find((i) => i.id === selectedID) ?? null,
    [investigations, selectedID]
  )

  async function run(): Promise<void> {
    const q = question.trim()
    if (!q || running) return
    setRunning(true)
    setRunError(null)
    try {
      const created = await km.notebook.run(q)
      setQuestion('')
      list.reload()
      setSelectedID(created.id)
    } catch (e) {
      setRunError(String((e as Error)?.message ?? e))
    } finally {
      setRunning(false)
    }
  }

  async function remove(id: UUID): Promise<void> {
    await km.notebook.remove(id)
    if (selectedID === id) setSelectedID(null)
    list.reload()
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={<Notebook className="h-5 w-5" />}
        title="Notebook"
        subtitle="Plan-and-Solve investigations — decompose a question, answer each part with evidence, then synthesize."
      />
      <div className="flex min-h-0 flex-1">
        {/* Left column — list + new investigation */}
        <div className="flex w-80 shrink-0 flex-col border-r border-ink-800">
          <div className="space-y-2 border-b border-ink-800 p-4">
            <Input
              value={question}
              placeholder="New investigation…"
              disabled={running}
              onChange={(e) => setQuestion(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') run() }}
            />
            <Button variant="primary" className="w-full justify-center" disabled={running || !question.trim()} onClick={run}>
              {running ? <Spinner label="Investigating…" /> : (<><Play className="h-4 w-4" /> Run investigation</>)}
            </Button>
            {runError && <ErrorNote message={runError} />}
          </div>
          <Scroll className="flex-1">
            {list.loading ? (
              <Spinner label="Loading notebook…" />
            ) : list.error ? (
              <ErrorNote message={list.error} />
            ) : investigations.length === 0 ? (
              <EmptyState
                icon={<Notebook className="h-8 w-8" />}
                title="No investigations yet"
                hint="Ask a question above to run a Plan-and-Solve investigation."
              />
            ) : (
              <div className="space-y-1">
                {investigations.map((inv) => (
                  <button
                    key={inv.id}
                    onClick={() => setSelectedID(inv.id)}
                    className={
                      'block w-full rounded-lg border px-3 py-2 text-left transition-colors ' +
                      (inv.id === selectedID
                        ? 'border-accent/40 bg-accent/10'
                        : 'border-ink-800 bg-ink-900/40 hover:border-ink-700')
                    }
                  >
                    <div className="line-clamp-2 text-sm font-medium text-ink-200">{inv.question}</div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-ink-500">
                      <span>{fmtDateTime(inv.createdAt)}</span>
                      <Badge tone={inv.synthesis ? 'high' : 'medium'}>
                        {inv.synthesis ? 'complete' : 'no synthesis'}
                      </Badge>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Scroll>
        </div>

        {/* Right pane — detail */}
        <div className="min-w-0 flex-1">
          {selected ? (
            <Detail investigation={selected} onDelete={() => remove(selected.id)} />
          ) : (
            <Scroll>
              <EmptyState
                icon={<ArrowLeft className="h-8 w-8" />}
                title="Pick an investigation"
                hint="Select one from the list, or run a new one to see its sub-answers and synthesis."
              />
            </Scroll>
          )}
        </div>
      </div>
    </div>
  )
}

function Detail({ investigation, onDelete }: { investigation: Investigation; onDelete: () => void }): JSX.Element {
  const inv = investigation
  const answered = inv.steps.filter((s) => s.answerBody != null)
  const confs = answered
    .map((s) => s.answerConfidence)
    .filter((c): c is number => c != null)
  const avgConf = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0
  const totalCitations = inv.steps.reduce((n, s) => n + s.answerCitations.length, 0)

  return (
    <Scroll>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">Original question</div>
            <h2 className="mt-1 text-lg font-medium text-ink-100">{inv.question}</h2>
            <div className="mt-1 text-xs text-ink-500">
              {fmtDateTime(inv.createdAt)}
              {inv.finishedAt != null && ` · finished ${fmtDateTime(inv.finishedAt)}`}
            </div>
          </div>
          <Button className="shrink-0 text-ink-500 hover:text-rose-400" onClick={onDelete}>
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Steps" value={`${answered.length}/${inv.steps.length}`} />
          <StatTile label="Avg confidence" value={fmtPct(avgConf)} tone="accent" />
          <StatTile label="Citations" value={fmtNum(totalCitations)} />
          <StatTile label="Status" value={inv.synthesis ? 'Complete' : 'Partial'} />
        </div>

        {inv.synthesis && (
          <Card title="Synthesis" right={<Sparkles className="h-4 w-4 text-accent-soft" />}>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-200">{inv.synthesis}</p>
          </Card>
        )}

        <div className="space-y-3">
          <div className="text-sm font-semibold text-ink-200">Sub-questions ({inv.steps.length})</div>
          {inv.steps.length === 0 ? (
            <EmptyState title="No steps recorded" hint="This investigation produced no sub-questions." />
          ) : (
            inv.steps
              .slice()
              .sort((a, b) => a.ordinal - b.ordinal)
              .map((step) => <StepCard key={step.id} step={step} />)
          )}
        </div>
      </div>
    </Scroll>
  )
}

function StepCard({ step }: { step: InvestigationStep }): JSX.Element {
  const conf = step.answerConfidence
  const cl = conf != null ? confidenceLabel(conf) : null
  const citeCount = step.answerCitations.length
  return (
    <Card>
      <div className="flex items-start gap-2">
        <span className="text-sm font-semibold tabular-nums text-accent-soft">{step.ordinal}.</span>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="text-sm font-medium text-ink-100">{step.question}</div>
          {step.answerBody != null ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-400">{step.answerBody}</p>
          ) : (
            <p className="text-sm italic text-ink-600">(no answer recorded)</p>
          )}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-ink-500">
              <span className="flex items-center gap-2">
                Confidence {conf != null ? fmtPct(conf) : '—'}
                {cl && <Badge tone={cl.tone}>{cl.label}</Badge>}
              </span>
              <span>{fmtNum(citeCount)} citation{citeCount === 1 ? '' : 's'}</span>
            </div>
            <Meter value={conf ?? 0} tone={cl ? cl.tone : 'accent'} />
          </div>
        </div>
      </div>
    </Card>
  )
}
