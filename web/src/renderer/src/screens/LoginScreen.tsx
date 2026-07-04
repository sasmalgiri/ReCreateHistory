//
// LoginScreen — sign up / log in. The public front door of the hosted app.
//

import { useState } from 'react'
import { ShieldCheck, Sparkles, LogIn, UserPlus } from 'lucide-react'
import { authApi, useAuth } from '../lib/auth'
import { Button, Input, ErrorNote } from '../components/ui'

export default function LoginScreen(): JSX.Element {
  const { refresh } = useAuth()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      if (mode === 'signup') await authApi.signup(email, password, displayName || undefined)
      else await authApi.login(email, password)
      await refresh()
    } catch (err) {
      setError(String((err as Error).message ?? err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-ink-950 p-6">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-2xl border border-ink-800 md:grid-cols-2">
        {/* Brand panel */}
        <div className="hidden flex-col justify-between bg-ink-900/60 p-8 md:flex">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/20 text-xl text-accent-soft">RH</div>
            <div>
              <div className="text-base font-semibold text-ink-50">ReCreateHistory</div>
              <div className="text-[10px] uppercase tracking-wider text-ink-500">knowledge OS · online</div>
            </div>
          </div>
          <div className="space-y-4">
            <Feature icon={<Sparkles className="h-4 w-4" />} title="The intelligence is in the database"
              body="Not chat-with-files — a structured ledger of entities, events, timelines, and memory, each fact carrying its sources." />
            <Feature icon={<ShieldCheck className="h-4 w-4" />} title="Your own private workspace"
              body="Every account gets an isolated ledger. Answers are gated by evidence — no sources, no answer." />
          </div>
          <div className="text-[11px] text-ink-600">Ingest anything · cited answers · timelines & dossiers</div>
        </div>

        {/* Form panel */}
        <div className="bg-ink-950 p-8">
          <h1 className="text-lg font-semibold text-ink-50">
            {mode === 'signup' ? 'Create your account' : 'Welcome back'}
          </h1>
          <p className="mt-1 text-sm text-ink-400">
            {mode === 'signup' ? 'Start building your private knowledge base.' : 'Log in to your knowledge base.'}
          </p>
          <form className="mt-6 space-y-3" onSubmit={submit}>
            {mode === 'signup' && (
              <Field label="Name (optional)">
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" autoComplete="name" />
              </Field>
            )}
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
            </Field>
            <Field label="Password">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required />
            </Field>
            {error && <ErrorNote message={error} />}
            <Button type="submit" variant="primary" className="w-full justify-center" disabled={busy}>
              {mode === 'signup' ? <><UserPlus className="h-4 w-4" /> Sign up</> : <><LogIn className="h-4 w-4" /> Log in</>}
            </Button>
          </form>
          <div className="mt-4 text-center text-sm text-ink-500">
            {mode === 'signup' ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button className="text-accent-soft hover:underline" onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setError(null) }}>
              {mode === 'signup' ? 'Log in' : 'Sign up'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block">
      <div className="mb-1 text-xs uppercase tracking-wide text-ink-500">{label}</div>
      {children}
    </label>
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
