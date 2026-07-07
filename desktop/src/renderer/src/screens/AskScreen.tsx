//
// AskScreen — the flagship. Ask a question; the MasterBrain detects intent,
// retrieves evidence, consults experts, and returns a cited, evidence-gated
// answer with a Quality Strip. Streaming stage events show the pipeline work.
//

import { useEffect, useRef, useState } from 'react'
import { MessagesSquare, Send, Bookmark, Compass, FileText } from 'lucide-react'
import { km } from '../lib/km'
import { PageHeader, Button, Textarea, Card, Spinner, EmptyState, Badge } from '../components/ui'
import { QualityStrip } from '../components/QualityStrip'
import type { VerifiedAnswer } from '../../../shared/ai'
import type { AskUpdate } from '../../../shared/ipc'

export default function AskScreen(): JSX.Element {
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<string>('')
  const [instant, setInstant] = useState<string | null>(null)
  const [answer, setAnswer] = useState<VerifiedAnswer | null>(null)
  const [asked, setAsked] = useState<string>('')
  const activeID = useRef<string | null>(null)

  useEffect(() => {
    const off = km.ask.onUpdate((u: AskUpdate) => {
      if (u.id !== activeID.current) return
      if (u.kind === 'stage') setStage(u.label)
      else if (u.kind === 'instant') setInstant(u.body)
      else if (u.kind === 'verified') { setAnswer(u.answer); setBusy(false); setStage('') }
      else if (u.kind === 'error') { setStage(`Error: ${u.message}`); setBusy(false) }
    })
    return off
  }, [])

  async function run(explicit?: string): Promise<void> {
    const q = (explicit ?? question).trim()
    if (!q || busy) return
    if (explicit) setQuestion(explicit)
    setBusy(true); setAnswer(null); setInstant(null); setStage('Starting…'); setAsked(q)
    const { id } = await km.ask.start(q)
    activeID.current = id
  }

  async function save(): Promise<void> {
    if (asked) await km.saved.add(asked)
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={<MessagesSquare className="h-5 w-5" />}
        title="Ask"
        subtitle="Answers are grounded in your ledger and gated by evidence — every claim carries its sources."
        actions={answer && !answer.refused ? <Button onClick={save}><Bookmark className="h-4 w-4" /> Save</Button> : undefined}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
        <Card className="p-3">
          <Textarea
            rows={3}
            value={question}
            placeholder="Ask about your documents, emails, people, projects, money, timelines…"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run() }}
          />
          <div className="mt-2 flex items-center justify-between">
            <div className="text-xs text-ink-500">⌘/Ctrl + Enter to ask</div>
            <Button variant="primary" onClick={() => run()} disabled={busy || !question.trim()}>
              <Send className="h-4 w-4" /> Ask
            </Button>
          </div>
        </Card>

        {busy && (
          <Card><Spinner label={stage || 'Thinking…'} /></Card>
        )}

        {instant && !answer && (
          <Card title="Quick read · verifying…">
            <div className="text-sm text-ink-300">{instant}</div>
            <Badge tone="medium">unverified memory cache</Badge>
          </Card>
        )}

        {answer && <AnswerView answer={answer} onFollowUp={(q) => run(q)} />}

        {!busy && !answer && (
          <EmptyState
            icon={<Compass className="h-8 w-8" />}
            title="Ask anything about your archive"
            hint="Try: “Reconstruct the timeline for project X”, “Who did I email about the invoice?”, “What risks are open?”"
          />
        )}
      </div>
    </div>
  )
}

function AnswerView({ answer, onFollowUp }: { answer: VerifiedAnswer; onFollowUp: (q: string) => void }): JSX.Element {
  if (answer.refused) {
    return (
      <Card>
        <div className="text-sm font-medium text-rose-300">Refused — insufficient evidence</div>
        <div className="mt-1 text-sm text-ink-400">{answer.refusalReason ?? answer.body}</div>
      </Card>
    )
  }
  // The answer IS the product. It gets the stage; verification mechanics live
  // behind one quiet disclosure for whoever wants to audit them.
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink-50">{answer.body}</div>
        {answer.gaps.length > 0 && (
          <div className="mt-3 border-t border-ink-800 pt-2 text-xs text-ink-500">
            Not in your sources: {answer.gaps.join('; ')}
          </div>
        )}
      </Card>
      {answer.followUps.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {answer.followUps.map((q, i) => (
            <button key={i} type="button" onClick={() => onFollowUp(q)} className="chip hover:border-accent hover:text-accent-soft">{q}</button>
          ))}
        </div>
      )}
      <details className="group">
        <summary className="cursor-pointer select-none text-xs text-ink-500 hover:text-ink-300">
          How this was verified · {answer.citations.length} source{answer.citations.length === 1 ? '' : 's'}
        </summary>
        <div className="mt-3 space-y-4">
          <QualityStrip answer={answer} />
          {answer.citations.length > 0 && (
            <Card title={`Citations (${answer.citations.length})`}>
              <div className="space-y-2">
                {answer.citations.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-md border border-ink-800 bg-ink-900/50 px-3 py-2 text-xs">
                    <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-500" />
                    <div>
                      <div className="text-ink-300">{c.snippet}</div>
                      <div className="mt-0.5 text-ink-600">{c.eventID ? 'event' : 'document'} · {c.objectID.slice(0, 8)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </details>
    </div>
  )
}
