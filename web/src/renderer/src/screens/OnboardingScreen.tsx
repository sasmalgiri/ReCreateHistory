//
// OnboardingScreen — first-run modal. Mirrors UI/OnboardingView.swift. Explains
// the local-first model and helps the user add their first folder.
//

import { Upload, ShieldCheck, Sparkles, X } from 'lucide-react'
import { uploadAndIngest } from '../lib/km'
import { Button } from '../components/ui'

export default function OnboardingScreen({ onClose }: { onClose: () => void }): JSX.Element {
  async function addFiles(): Promise<void> {
    const n = await uploadAndIngest()
    if (n > 0) onClose()
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="card relative w-[560px] max-w-[92vw] p-8">
        <button className="absolute right-4 top-4 text-ink-500 hover:text-ink-200" onClick={onClose}><X className="h-4 w-4" /></button>
        <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-accent/20 text-2xl text-accent-soft">RH</div>
        <h1 className="text-xl font-semibold text-ink-50">Welcome to ReCreateHistory</h1>
        <p className="mt-1 text-sm text-ink-400">
          A local-first knowledge OS. Point it at your documents and it builds a structured ledger —
          entities, events, timelines, and distilled memory — then answers with cited evidence.
        </p>
        <div className="mt-5 space-y-3">
          <Feature icon={<ShieldCheck className="h-4 w-4" />} title="Your own private workspace"
            body="Each account gets an isolated ledger. Answers are gated by evidence — no sources, no answer." />
          <Feature icon={<Sparkles className="h-4 w-4" />} title="The intelligence is in the database"
            body="Not chat-with-files — a real ledger of extracted facts, each with sources and confidence." />
        </div>
        <div className="mt-6 flex items-center justify-between">
          <button className="text-sm text-ink-500 hover:text-ink-300" onClick={onClose}>Skip for now</button>
          <Button variant="primary" onClick={addFiles}><Upload className="h-4 w-4" /> Upload documents</Button>
        </div>
      </div>
    </div>
  )
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }): JSX.Element {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 text-accent-soft">{icon}</div>
      <div>
        <div className="text-sm font-medium text-ink-200">{title}</div>
        <div className="text-xs text-ink-500">{body}</div>
      </div>
    </div>
  )
}
