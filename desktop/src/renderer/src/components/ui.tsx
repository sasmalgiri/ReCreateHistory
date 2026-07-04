//
// ui.tsx — the shared UI kit. Every screen composes these primitives so the
// app reads as one system. Calm, archival, dark-first.
//

import { clsx } from 'clsx'
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { Loader2 } from 'lucide-react'

export function PageHeader({ title, subtitle, actions, icon }: {
  title: string; subtitle?: string; actions?: ReactNode; icon?: ReactNode
}): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-ink-800 px-6 py-4">
      <div className="flex items-start gap-3">
        {icon && <div className="mt-0.5 text-accent">{icon}</div>}
        <div>
          <h1 className="text-lg font-semibold text-ink-50">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-ink-400">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ children, className, title, right }: {
  children: ReactNode; className?: string; title?: string; right?: ReactNode
}): JSX.Element {
  return (
    <div className={clsx('card p-4', className)}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between">
          {title && <h3 className="text-sm font-semibold text-ink-200">{title}</h3>}
          {right}
        </div>
      )}
      {children}
    </div>
  )
}

export function Button({ variant = 'ghost', className, children, ...rest }: {
  variant?: 'primary' | 'ghost'
} & ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return (
    <button className={clsx(variant === 'primary' ? 'btn-primary' : 'btn-ghost', className)} {...rest}>
      {children}
    </button>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return <input {...props} className={clsx('input', props.className)} />
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element {
  return <textarea {...props} className={clsx('input resize-none', props.className)} />
}

export function Badge({ children, tone = 'neutral' }: {
  children: ReactNode; tone?: 'neutral' | 'high' | 'medium' | 'low' | 'accent'
}): JSX.Element {
  const tones: Record<string, string> = {
    neutral: 'border-ink-700 bg-ink-800/60 text-ink-300',
    high: 'border-emerald-800 bg-emerald-900/30 text-emerald-300',
    medium: 'border-amber-800 bg-amber-900/30 text-amber-300',
    low: 'border-rose-900 bg-rose-950/40 text-rose-300',
    accent: 'border-accent/40 bg-accent/10 text-accent-soft'
  }
  return <span className={clsx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs', tones[tone])}>{children}</span>
}

export function Spinner({ label }: { label?: string }): JSX.Element {
  return (
    <div className="flex items-center gap-2 text-sm text-ink-400">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label ?? 'Loading…'}
    </div>
  )
}

export function EmptyState({ icon, title, hint, action }: {
  icon?: ReactNode; title: string; hint?: string; action?: ReactNode
}): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-ink-800 py-16 text-center">
      {icon && <div className="text-ink-600">{icon}</div>}
      <div className="text-sm font-medium text-ink-300">{title}</div>
      {hint && <div className="max-w-md text-xs text-ink-500">{hint}</div>}
      {action}
    </div>
  )
}

export function StatTile({ label, value, hint, tone }: {
  label: string; value: ReactNode; hint?: string; tone?: 'accent' | 'neutral'
}): JSX.Element {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-ink-500">{label}</div>
      <div className={clsx('mt-1 text-2xl font-semibold tabular-nums', tone === 'accent' ? 'text-accent-soft' : 'text-ink-50')}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-500">{hint}</div>}
    </div>
  )
}

export function Scroll({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={clsx('h-full overflow-y-auto px-6 py-5', className)}>{children}</div>
}

export function ErrorNote({ message }: { message: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-rose-900 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
      {message}
    </div>
  )
}

export function Meter({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'high' | 'medium' | 'low' }): JSX.Element {
  const colors: Record<string, string> = {
    accent: 'bg-accent', high: 'bg-emerald-500', medium: 'bg-amber-500', low: 'bg-rose-500'
  }
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
      <div className={clsx('h-full rounded-full transition-all', colors[tone])} style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </div>
  )
}
