//
// ConvertScreen — Atlas-as-parser. A one-shot conversion surface that reuses
// the same best-in-class loaders the ingest pipeline uses, but writes nothing
// to the knowledge ledger. Mirrors UI/ConvertView.swift. Two modes:
//   • Extract from file — pick a file, parse it, get clean text + its source type.
//   • Transform text   — reshape pasted text into a summary, Markdown, or plain.
//

import { useState } from 'react'
import { Wand2, FilePlus, ArrowRightCircle, Copy, Check, FileText, Type } from 'lucide-react'
import { km } from '../lib/km'
import { PageHeader, Card, Button, Textarea, Badge, Spinner, EmptyState, ErrorNote, Scroll } from '../components/ui'

type Mode = 'extract' | 'transform'
type Target = 'summary' | 'markdown' | 'plain'

const TARGETS: { value: Target; label: string }[] = [
  { value: 'summary', label: 'Summary' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'plain', label: 'Plain text' }
]

export default function ConvertScreen(): JSX.Element {
  const [mode, setMode] = useState<Mode>('extract')

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={<Wand2 className="h-5 w-5" />}
        title="Convert"
        subtitle="Parse any supported file or reshape raw text. One-shot — nothing is added to your knowledge ledger."
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-ink-800 bg-ink-900/60 p-0.5 text-xs">
            <ModeTab active={mode === 'extract'} onClick={() => setMode('extract')} icon={<FileText className="h-3.5 w-3.5" />} label="Extract from file" />
            <ModeTab active={mode === 'transform'} onClick={() => setMode('transform')} icon={<Type className="h-3.5 w-3.5" />} label="Transform text" />
          </div>
        }
      />
      <Scroll>
        {mode === 'extract' ? <ExtractPanel /> : <TransformPanel />}
      </Scroll>
    </div>
  )
}

function ModeTab({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: JSX.Element; label: string
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors ' +
        (active ? 'bg-accent/15 text-accent-soft' : 'text-ink-400 hover:text-ink-200')
      }
    >
      {icon}{label}
    </button>
  )
}

// ── Extract from file ─────────────────────────────────────────────────────

function ExtractPanel(): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [path, setPath] = useState<string | null>(null)
  const [result, setResult] = useState<{ text: string; sourceType: string } | null>(null)

  async function pickAndConvert(): Promise<void> {
    setError(null)
    const picked = await km.ingest.pickFiles().catch((e: unknown) => {
      setError(String((e as Error)?.message ?? e)); return [] as string[]
    })
    if (!picked.length) return
    const first = picked[0]
    setPath(first)
    setResult(null)
    setBusy(true)
    try {
      const r = await km.convert.file(first)
      setResult(r)
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  const fileName = path ? path.split(/[\\/]/).pop() : null

  return (
    <div className="space-y-4">
      <Card title="Source file" right={
        <Button variant="primary" onClick={pickAndConvert} disabled={busy}>
          <FilePlus className="h-4 w-4" /> Pick file…
        </Button>
      }>
        {fileName ? (
          <div className="flex items-center gap-3 text-sm">
            <FileText className="h-4 w-4 shrink-0 text-ink-500" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-ink-200">{fileName}</div>
              <div className="truncate text-xs text-ink-600">{path}</div>
            </div>
            {result && <Badge tone="accent">{result.sourceType}</Badge>}
          </div>
        ) : (
          <div className="text-sm text-ink-500">
            Pick a PDF, image, audio, email, mbox, PST, NSF, DOCX, XLSX, or any supported file to extract clean text.
          </div>
        )}
      </Card>

      {error && <ErrorNote message={error} />}

      <Card title="Extracted text" right={result ? <Badge tone="neutral">{result.text.length.toLocaleString('en-US')} chars</Badge> : undefined}>
        {busy ? (
          <Spinner label="Parsing file…" />
        ) : !result ? (
          <EmptyState icon={<FileText className="h-8 w-8" />} title="No extraction yet"
            hint="Pick a file above to run the format-specific loader and read its contents." />
        ) : result.text.trim().length === 0 ? (
          <EmptyState icon={<FileText className="h-8 w-8" />} title="No text found"
            hint="The loader parsed the file but returned no readable text." />
        ) : (
          <pre className="max-h-[26rem] overflow-auto whitespace-pre-wrap rounded-lg border border-ink-800 bg-ink-900/50 p-3 text-xs leading-relaxed text-ink-200">
            {result.text}
          </pre>
        )}
      </Card>
    </div>
  )
}

// ── Transform text ────────────────────────────────────────────────────────

function TransformPanel(): JSX.Element {
  const [input, setInput] = useState('')
  const [target, setTarget] = useState<Target>('summary')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [output, setOutput] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function convert(): Promise<void> {
    if (!input.trim()) return
    setError(null)
    setOutput(null)
    setBusy(true)
    try {
      const r = await km.convert.text(input, 'auto', target)
      setOutput(r.output)
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  async function copy(): Promise<void> {
    if (output == null) return
    await navigator.clipboard.writeText(output)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Input" right={
        <div className="flex items-center gap-2">
          <select
            aria-label="Target format"
            title="Target format"
            value={target}
            onChange={(e) => setTarget(e.target.value as Target)}
            className="input h-8 py-0 text-xs"
          >
            {TARGETS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <Button variant="primary" onClick={convert} disabled={busy || !input.trim()}>
            <ArrowRightCircle className="h-4 w-4" /> Convert
          </Button>
        </div>
      }>
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste text to reshape into a summary, Markdown, or clean plain text…"
          rows={16}
          className="w-full font-mono text-xs"
        />
        <div className="mt-2 text-xs text-ink-600">{input.length.toLocaleString('en-US')} characters</div>
      </Card>

      <Card title="Output" right={output != null ? (
        <Button onClick={copy}>
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      ) : undefined}>
        {error && <ErrorNote message={error} />}
        {busy ? (
          <Spinner label="Transforming…" />
        ) : output == null ? (
          !error && <EmptyState icon={<Wand2 className="h-8 w-8" />} title="No output yet"
            hint="Enter text, pick a target format, and press Convert." />
        ) : output.trim().length === 0 ? (
          <EmptyState icon={<Wand2 className="h-8 w-8" />} title="Empty result"
            hint="The transform returned nothing for this input." />
        ) : (
          <pre className="mt-2 max-h-[26rem] overflow-auto whitespace-pre-wrap rounded-lg border border-ink-800 bg-ink-900/50 p-3 text-xs leading-relaxed text-ink-200">
            {output}
          </pre>
        )}
      </Card>
    </div>
  )
}
