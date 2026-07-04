//
// SavedScreen — bookmarked questions. Mirrors UI/SavedQueriesView.swift. Save a
// question (with an optional title), then re-run it one click through the same
// evidence-gated Ask pipeline and read the verified answer inline.
//

import { useState } from 'react'
import { Bookmark, BookmarkPlus, Play, Trash2, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'
import { km, useAsync } from '../lib/km'
import { PageHeader, Card, Button, Input, Badge, Spinner, EmptyState, Scroll, ErrorNote, Meter } from '../components/ui'
import { fmtRelative, fmtPct, confidenceLabel } from '../lib/format'
import type { SavedQuery } from '../../../shared/ipc'
import type { VerifiedAnswer } from '../../../shared/ai'
import type { UUID } from '../../../shared/models'

interface RunState {
  loading: boolean
  answer: VerifiedAnswer | null
  error: string | null
  open: boolean
}

export default function SavedScreen(): JSX.Element {
  const saved = useAsync<SavedQuery[]>(() => km.saved.list(), [])
  const [question, setQuestion] = useState('')
  const [title, setTitle] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [runs, setRuns] = useState<Record<string, RunState>>({})

  async function add(): Promise<void> {
    const q = question.trim()
    if (!q) return
    setAdding(true)
    setAddError(null)
    try {
      await km.saved.add(q, title.trim() || undefined)
      setQuestion('')
      setTitle('')
      saved.reload()
    } catch (e) {
      setAddError(String((e as { message?: string })?.message ?? e))
    } finally {
      setAdding(false)
    }
  }

  function patchRun(id: UUID, patch: Partial<RunState>): void {
    const base: RunState = { loading: false, answer: null, error: null, open: true }
    setRuns((prev) => ({ ...prev, [id]: { ...base, ...prev[id], ...patch } }))
  }

  async function run(item: SavedQuery): Promise<void> {
    patchRun(item.id, { loading: true, error: null, open: true })
    try {
      await km.saved.touch(item.id)
      const answer = await km.ask.ask(item.question)
      patchRun(item.id, { loading: false, answer })
      saved.reload()
    } catch (e) {
      patchRun(item.id, { loading: false, error: String((e as { message?: string })?.message ?? e) })
    }
  }

  async function remove(id: UUID): Promise<void> {
    await km.saved.remove(id)
    setRuns((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    saved.reload()
  }

  function toggle(id: UUID): void {
    setRuns((prev) => {
      const cur = prev[id]
      if (!cur) return prev
      return { ...prev, [id]: { ...cur, open: !cur.open } }
    })
  }

  const items = saved.data ?? []

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={<Bookmark className="h-5 w-5" />}
        title="Saved questions"
        subtitle="Bookmark the questions you keep coming back to, then re-run them through the evidence gate in one click."
        actions={
          <>
            <Badge tone="neutral">{items.length} saved</Badge>
            <Button onClick={saved.reload}><RefreshCw className="h-3.5 w-3.5" /></Button>
          </>
        }
      />
      <Scroll>
        <div className="space-y-4">
          <Card title="Save a question">
            <div className="space-y-2">
              <Input
                placeholder="What do you want to be able to ask again?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); add() } }}
              />
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Optional title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
                  className="flex-1"
                />
                <Button variant="primary" onClick={add} disabled={adding || !question.trim()}>
                  <BookmarkPlus className="h-4 w-4" /> Save
                </Button>
              </div>
              {addError && <ErrorNote message={addError} />}
            </div>
          </Card>

          {saved.loading ? (
            <Spinner label="Loading saved questions…" />
          ) : saved.error ? (
            <ErrorNote message={saved.error} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Bookmark className="h-8 w-8" />}
              title="No saved questions yet"
              hint="Save a question above to keep it here. Re-run it any time to reconstruct a fresh, evidence-gated answer as your ledger grows."
            />
          ) : (
            <div className="space-y-2">
              {items.map((item) => {
                const st = runs[item.id]
                return (
                  <Card key={item.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-ink-100">{item.title || item.question}</span>
                          {item.category && <Badge tone="accent">{item.category}</Badge>}
                        </div>
                        {item.title && <div className="mt-0.5 truncate text-xs text-ink-400">{item.question}</div>}
                        {item.notes && <div className="mt-1 text-xs text-ink-500">{item.notes}</div>}
                        <div className="mt-1 text-xs text-ink-600">
                          Saved {fmtRelative(item.createdAt)}
                          {item.lastRunAt != null && <span> · last run {fmtRelative(item.lastRunAt)}</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button variant="primary" onClick={() => run(item)} disabled={st?.loading}>
                          {st?.loading ? <Spinner /> : <><Play className="h-3.5 w-3.5" /> Run</>}
                        </Button>
                        <button className="p-1.5 text-ink-500 hover:text-rose-400" title="Delete" onClick={() => remove(item.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {st && (st.answer || st.error || st.loading) && (
                      <div className="mt-3 border-t border-ink-800 pt-3">
                        {st.error ? (
                          <ErrorNote message={st.error} />
                        ) : st.loading ? (
                          <Spinner label="Reconstructing answer…" />
                        ) : st.answer ? (
                          <AnswerBlock answer={st.answer} open={st.open} onToggle={() => toggle(item.id)} />
                        ) : null}
                      </div>
                    )}
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </Scroll>
    </div>
  )
}

function AnswerBlock({ answer, open, onToggle }: { answer: VerifiedAnswer; open: boolean; onToggle: () => void }): JSX.Element {
  const conf = confidenceLabel(answer.confidence)
  return (
    <div>
      <button className="flex w-full items-center gap-2 text-left" onClick={onToggle}>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-ink-500" /> : <ChevronRight className="h-3.5 w-3.5 text-ink-500" />}
        <span className="text-xs font-semibold text-ink-300">Answer</span>
        <Badge tone={answer.refused ? 'low' : conf.tone}>{answer.refused ? 'Refused' : conf.label}</Badge>
        <span className="text-xs text-ink-500">{fmtPct(answer.confidence)}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <Meter value={answer.confidence} tone={conf.tone} />
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-200">
            {answer.refused ? (answer.refusalReason || 'The evidence gate declined to answer.') : (answer.answerText || answer.body)}
          </p>
          {answer.citations.length > 0 && (
            <div className="text-xs text-ink-600">{answer.citations.length} citation{answer.citations.length === 1 ? '' : 's'}</div>
          )}
        </div>
      )}
    </div>
  )
}
