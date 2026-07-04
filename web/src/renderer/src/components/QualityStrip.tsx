//
// QualityStrip.tsx — the per-answer UI showing confidence, evidence counts,
// timeliness, conflicts, and the answer source. Ported from UI/QualityStrip.
// This is the trust surface: it lets a user tell a structured reconstruction
// from a generic chunk-RAG synthesis.
//

import type { VerifiedAnswer } from '../../../shared/ai'
import { answerSourceDisplay } from '../../../shared/ai'
import { Badge, Meter } from './ui'
import { confidenceLabel, fmtPct } from '../lib/format'
import { AlertTriangle, ShieldCheck, FileText, CalendarClock } from 'lucide-react'

export function QualityStrip({ answer }: { answer: VerifiedAnswer }): JSX.Element {
  const c = confidenceLabel(answer.confidence)
  const r = answer.report
  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">{answerSourceDisplay[answer.source]}</Badge>
        <Badge tone={c.tone}>
          <ShieldCheck className="h-3 w-3" /> {c.label} confidence · {fmtPct(answer.confidence)}
        </Badge>
        <Badge tone="neutral"><FileText className="h-3 w-3" /> {answer.citations.length} citations</Badge>
        {r?.eventCount ? <Badge tone="neutral"><CalendarClock className="h-3 w-3" /> {r.eventCount} events</Badge> : null}
        {answer.contradictions.length > 0 && (
          <Badge tone="low"><AlertTriangle className="h-3 w-3" /> {answer.contradictions.length} conflict(s)</Badge>
        )}
      </div>
      <Meter value={answer.confidence} tone={c.tone} />
      {r && (
        <div className="grid grid-cols-2 gap-2 text-xs text-ink-400 sm:grid-cols-4">
          <Stat label="Evidence" value={String(r.evidenceCount)} />
          <Stat label="Entities" value={String(r.entityCount)} />
          <Stat label="Freshness" value={r.freshnessDays != null ? `${r.freshnessDays}d` : '—'} />
          <Stat label="Coverage" value={r.temporalCoverageDays != null ? `${r.temporalCoverageDays}d` : '—'} />
        </div>
      )}
      {answer.contradictions.length > 0 && (
        <div className="space-y-1">
          {answer.contradictions.map((k, i) => (
            <div key={i} className="rounded-md border border-rose-900/60 bg-rose-950/30 px-2 py-1 text-xs text-rose-300">
              <b>{k.description}:</b> {k.claimA} vs {k.claimB}
            </div>
          ))}
        </div>
      )}
      {answer.reasoningTrace && (
        <details className="text-xs text-ink-400">
          <summary className="cursor-pointer select-none text-ink-300 hover:text-ink-100">Why this answer?</summary>
          <div className="mt-2 space-y-1 border-l border-ink-800 pl-3">
            <div>Layers: {answer.reasoningTrace.layersFired.join(' → ') || '—'}</div>
            <div>Experts: {answer.reasoningTrace.expertsRun.join(', ') || '—'}</div>
            {answer.reasoningTrace.steps.map((s, i) => (
              <div key={i}><span className="text-ink-300">{s.label}:</span> {s.detail}</div>
            ))}
            {answer.reasoningTrace.uncertainties.map((u, i) => (
              <div key={`u${i}`} className="text-amber-400">⚠ {u}</div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div className="uppercase tracking-wide text-ink-600">{label}</div>
      <div className="text-ink-200">{value}</div>
    </div>
  )
}
