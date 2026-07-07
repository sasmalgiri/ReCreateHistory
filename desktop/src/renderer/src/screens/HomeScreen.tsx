//
// HomeScreen — the front door. A card per use-case (lawyer, investigator,
// journalist, researcher, everyone); clicking a card opens that persona's
// guided workspace: a 3-step flow, example questions (click-to-ask), the
// screens that matter for that work, and tips. Copy lives in lib/guide.ts.
//

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ArrowLeft, MessageCircleQuestion, Lightbulb, Compass } from 'lucide-react'
import { PERSONAS, type Persona } from '../lib/guide'
import { Card, Button, Scroll, Badge } from '../components/ui'
import { km, useAsync } from '../lib/km'
import { fmtNum } from '../lib/format'

export default function HomeScreen(): JSX.Element {
  const [selected, setSelected] = useState<Persona | null>(() => {
    const id = localStorage.getItem('rch.persona')
    return PERSONAS.find((p) => p.id === id) ?? null
  })

  function choose(p: Persona | null): void {
    setSelected(p)
    if (p) localStorage.setItem('rch.persona', p.id)
    else localStorage.removeItem('rch.persona')
  }

  return (
    <div className="flex h-full flex-col">
      <Scroll>
        {selected ? <Workspace p={selected} onBack={() => choose(null)} /> : <CardGrid onChoose={choose} />}
      </Scroll>
    </div>
  )
}

// ── The card grid ───────────────────────────────────────────────────────

function CardGrid({ onChoose }: { onChoose: (p: Persona) => void }): JSX.Element {
  const inv = useAsync(() => km.app.inventory(), [])
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8 mt-4 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/20 text-2xl text-accent-soft">RH</div>
        <h1 className="text-2xl font-semibold text-ink-50">What are you working on?</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-ink-400">
          ReCreateHistory turns your documents into an evidence ledger — timelines, entities,
          claims, and contradictions, with every conclusion cited. Pick your kind of work for a
          guided start, or jump straight in.
        </p>
        {inv.data && inv.data.files > 0 && (
          <div className="mt-3 text-xs text-ink-500">
            Your ledger: {fmtNum(inv.data.files)} files · {fmtNum(inv.data.events)} events · {fmtNum(inv.data.entities)} entities
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PERSONAS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onChoose(p)}
            className="group rounded-xl border border-ink-800 bg-ink-900/60 p-5 text-left transition-all hover:border-accent/50 hover:bg-ink-900"
          >
            <div className="text-3xl">{p.emoji}</div>
            <div className="mt-3 flex items-center gap-1.5 text-base font-semibold text-ink-50">
              {p.title}
              <ArrowRight className="h-4 w-4 text-ink-600 transition-transform group-hover:translate-x-0.5 group-hover:text-accent-soft" />
            </div>
            <div className="mt-1.5 text-xs leading-relaxed text-ink-400">{p.tagline}</div>
          </button>
        ))}
        {/* Guide card */}
        <a
          href="#/guide"
          className="group flex flex-col justify-center rounded-xl border border-dashed border-ink-700 p-5 text-left transition-colors hover:border-ink-500"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-ink-300">
            <Compass className="h-4 w-4" /> New here? Read the Guide
          </div>
          <div className="mt-1 text-xs text-ink-500">
            Every screen, every badge, every option — explained in two minutes.
          </div>
        </a>
      </div>
    </div>
  )
}

// ── A persona's guided workspace ────────────────────────────────────────

function Workspace({ p, onBack }: { p: Persona; onBack: () => void }): JSX.Element {
  const navigate = useNavigate()

  function askExample(q: string): void {
    localStorage.setItem('rch.ask.prefill', q)
    navigate('/ask')
  }

  return (
    <div className="mx-auto max-w-4xl">
      <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1 text-xs text-ink-500 hover:text-ink-200">
        <ArrowLeft className="h-3.5 w-3.5" /> All workspaces
      </button>

      <div className="mb-6 flex items-start gap-4">
        <div className="text-4xl">{p.emoji}</div>
        <div>
          <h1 className="text-xl font-semibold text-ink-50">{p.title}</h1>
          <p className="mt-1 text-sm text-ink-400">{p.tagline}</p>
        </div>
      </div>

      {/* The 3-step guided flow */}
      <div className="grid gap-3 md:grid-cols-3">
        {p.steps.map((s, i) => (
          <Card key={i} className="flex flex-col p-4">
            <div className="mb-2 flex h-6 w-6 items-center justify-center rounded-full bg-accent/20 text-xs font-semibold text-accent-soft">{i + 1}</div>
            <div className="text-sm font-medium text-ink-100">{s.title}</div>
            <div className="mt-1 flex-1 text-xs leading-relaxed text-ink-400">{s.body}</div>
            <Button className="mt-3 self-start" onClick={() => navigate(s.goto)}>
              {s.gotoLabel} <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Card>
        ))}
      </div>

      {/* Example questions — one click to ask */}
      <Card className="mt-4 p-4" title="Try asking">
        <div className="flex flex-wrap gap-2">
          {p.examples.map((q, i) => (
            <button
              key={i}
              type="button"
              onClick={() => askExample(q)}
              className="chip text-left hover:border-accent hover:text-accent-soft"
              title="Opens Ask with this question filled in"
            >
              <MessageCircleQuestion className="h-3 w-3 shrink-0" /> {q}
            </button>
          ))}
        </div>
      </Card>

      {/* Where things live */}
      <Card className="mt-4 p-4" title="The screens that matter for this work">
        <div className="space-y-1.5">
          {p.keyScreens.map((s) => (
            <button
              key={s.path}
              type="button"
              onClick={() => navigate(s.path)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-ink-800/60"
            >
              <Badge tone="accent">{s.label}</Badge>
              <span className="text-xs text-ink-400">— {s.why}</span>
            </button>
          ))}
        </div>
      </Card>

      {/* Tips */}
      <Card className="mt-4 p-4">
        {p.tips.map((t, i) => (
          <div key={i} className="flex items-start gap-2 py-1 text-xs leading-relaxed text-ink-400">
            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-soft" /> {t}
          </div>
        ))}
      </Card>
    </div>
  )
}
