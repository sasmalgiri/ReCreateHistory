//
// LoginScreen — the public front door: sign up, log in, forgot-password,
// reset (via #/reset?token=…) and email verification (via #/verify?token=…).
//

import { useEffect, useState } from 'react'
import { ShieldCheck, Sparkles, LogIn, UserPlus, KeyRound, MailCheck } from 'lucide-react'
import { authApi, useAuth } from '../lib/auth'
import { Button, Input, ErrorNote } from '../components/ui'

type Mode = 'login' | 'signup' | 'forgot' | 'reset'

async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    credentials: 'include', body: JSON.stringify(body)
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

function hashParam(name: string): string | null {
  const m = window.location.hash.match(new RegExp(`[#/?&]${name}=([^&]+)`))
  return m ? decodeURIComponent(m[1]) : null
}

export default function LoginScreen(): JSX.Element {
  const { refresh } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Deep links from emails: #/reset?token=… and #/verify?token=…
  useEffect(() => {
    const hash = window.location.hash
    if (hash.includes('/reset')) {
      const t = hashParam('token')
      if (t) { setResetToken(t); setMode('reset') }
    } else if (hash.includes('/verify')) {
      const t = hashParam('token')
      if (t) {
        post('/api/auth/verify-email', { token: t })
          .then(() => setNotice('Email verified — you can log in now.'))
          .catch((e) => setError(String(e.message ?? e)))
          .finally(() => { window.location.hash = '' })
      }
    }
  }, [])

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true); setError(null); setNotice(null)
    try {
      if (mode === 'signup') {
        const data = await post('/api/auth/signup', { email, password, displayName: displayName || undefined })
        if (data.verifyEmailSent) {
          setNotice('Account created — check your inbox for the verification link, then log in.')
          setMode('login')
        } else {
          await refresh()
        }
      } else if (mode === 'login') {
        await authApi.login(email, password)
        await refresh()
      } else if (mode === 'forgot') {
        await post('/api/auth/request-reset', { email })
        setNotice('If that account exists, a reset link is on its way. Check your inbox.')
        setMode('login')
      } else if (mode === 'reset') {
        await post('/api/auth/reset', { token: resetToken, password })
        setNotice('Password updated — log in with your new password.')
        window.location.hash = ''
        setMode('login')
      }
    } catch (err) {
      setError(String((err as Error).message ?? err))
    } finally {
      setBusy(false)
    }
  }

  const heading = mode === 'signup' ? 'Create your account'
    : mode === 'forgot' ? 'Reset your password'
    : mode === 'reset' ? 'Choose a new password'
    : 'Welcome back'
  const sub = mode === 'signup' ? 'Start building your private evidence ledger.'
    : mode === 'forgot' ? "Enter your email and we'll send a reset link."
    : mode === 'reset' ? 'Set a new password for your account.'
    : 'Log in to your evidence ledger.'

  return (
    <div className="flex h-full w-full items-center justify-center bg-ink-950 p-6">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-2xl border border-ink-800 md:grid-cols-2">
        {/* Brand panel */}
        <div className="hidden flex-col justify-between bg-ink-900/60 p-8 md:flex">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/20 text-xl text-accent-soft">RH</div>
            <div>
              <div className="text-base font-semibold text-ink-50">ReCreateHistory</div>
              <div className="text-[10px] uppercase tracking-wider text-ink-500">evidence ledger · online</div>
            </div>
          </div>
          <div className="space-y-4">
            <Feature icon={<Sparkles className="h-4 w-4" />} title="The intelligence is in the database"
              body="Not chat-with-files — a structured ledger of entities, events, claims, and timelines, each fact carrying its sources." />
            <Feature icon={<ShieldCheck className="h-4 w-4" />} title="Your own private workspace"
              body="Every account gets an isolated ledger. Answers are gated by evidence — proven facts separated from inference." />
          </div>
          <div className="text-[11px] text-ink-600">Ingest anything · cited answers · timelines & contradictions</div>
        </div>

        {/* Form panel */}
        <div className="bg-ink-950 p-8">
          <h1 className="text-lg font-semibold text-ink-50">{heading}</h1>
          <p className="mt-1 text-sm text-ink-400">{sub}</p>
          <form className="mt-6 space-y-3" onSubmit={submit}>
            {mode === 'signup' && (
              <Field label="Name (optional)">
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" autoComplete="name" />
              </Field>
            )}
            {mode !== 'reset' && (
              <Field label="Email">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
              </Field>
            )}
            {mode !== 'forgot' && (
              <Field label={mode === 'reset' ? 'New password' : 'Password'}>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'login' ? '••••••••' : 'At least 8 characters'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
              </Field>
            )}
            {error && <ErrorNote message={error} />}
            {notice && (
              <div className="rounded-lg border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
                <MailCheck className="mr-1 inline h-3.5 w-3.5" /> {notice}
              </div>
            )}
            <Button type="submit" variant="primary" className="w-full justify-center" disabled={busy}>
              {mode === 'signup' ? <><UserPlus className="h-4 w-4" /> Sign up</>
                : mode === 'forgot' ? <><KeyRound className="h-4 w-4" /> Send reset link</>
                : mode === 'reset' ? <><KeyRound className="h-4 w-4" /> Set new password</>
                : <><LogIn className="h-4 w-4" /> Log in</>}
            </Button>
          </form>

          <div className="mt-4 space-y-1 text-center text-sm text-ink-500">
            {mode === 'login' && (
              <>
                <div>
                  Don't have an account?{' '}
                  <button type="button" className="text-accent-soft hover:underline" onClick={() => { setMode('signup'); setError(null) }}>Sign up</button>
                </div>
                <div>
                  <button type="button" className="text-ink-500 hover:text-ink-300 hover:underline" onClick={() => { setMode('forgot'); setError(null) }}>Forgot password?</button>
                </div>
              </>
            )}
            {mode !== 'login' && (
              <button type="button" className="text-accent-soft hover:underline" onClick={() => { setMode('login'); setError(null) }}>Back to log in</button>
            )}
          </div>

          <div className="mt-6 border-t border-ink-800 pt-3 text-center text-[11px] text-ink-600">
            By using this service you agree to the{' '}
            <a href="/terms" target="_blank" rel="noreferrer" className="text-ink-500 underline hover:text-ink-300">Terms</a>{' '}and{' '}
            <a href="/privacy" target="_blank" rel="noreferrer" className="text-ink-500 underline hover:text-ink-300">Privacy Policy</a>.
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
