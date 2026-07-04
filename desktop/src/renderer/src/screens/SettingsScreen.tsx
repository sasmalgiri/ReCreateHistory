//
// SettingsScreen — capability routing controls. Mirrors UI/SettingsView.swift.
// Ollama is the default local/private engine; cloud is optional and gated by
// the PrivacyGate. Model names live only here + in the providers.
//

import { useState } from 'react'
import { Settings as SettingsIcon, ShieldCheck, Cloud, Cpu, RefreshCw } from 'lucide-react'
import { km, useAsync } from '../lib/km'
import { PageHeader, Card, Button, Input, Badge, Spinner, Scroll } from '../components/ui'
import type { Preferences } from '../../../shared/ipc'

export default function SettingsScreen(): JSX.Element {
  const prefs = useAsync(() => km.settings.get(), [])
  const providers = useAsync(() => km.settings.providers(), [])
  const models = useAsync(() => km.settings.ollamaModels(), [])
  const [apiKey, setApiKey] = useState('')

  async function patch(p: Partial<Preferences>): Promise<void> {
    await km.settings.set(p)
    prefs.reload(); providers.reload()
  }

  const p = prefs.data
  return (
    <div className="flex h-full flex-col">
      <PageHeader icon={<SettingsIcon className="h-5 w-5" />} title="Settings"
        subtitle="AI engine, privacy, and models. Everything runs locally unless you opt into cloud." />
      <Scroll>
        {!p ? <Spinner /> : (
          <div className="max-w-2xl space-y-4">
            <Card title="Providers" right={<Button onClick={() => { providers.reload(); models.reload() }}><RefreshCw className="h-3.5 w-3.5" /></Button>}>
              {providers.loading ? <Spinner /> : (
                <div className="space-y-2">
                  {providers.data?.map((pr) => (
                    <div key={pr.id} className="flex items-center justify-between rounded-md bg-ink-900/60 px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        {pr.privacyLevel === 'cloud' ? <Cloud className="h-4 w-4 text-ink-500" /> : <Cpu className="h-4 w-4 text-accent-soft" />}
                        <div>
                          <div className="text-ink-200">{pr.displayName}</div>
                          <div className="text-xs text-ink-600">{pr.privacyLevel} · {pr.capabilities.length} capabilities</div>
                        </div>
                      </div>
                      <Badge tone={pr.available ? 'high' : 'low'}>{pr.available ? 'ready' : pr.detail}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Ollama (local engine)">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Server URL">
                  <Input defaultValue={p.ollamaBaseURL} onBlur={(e) => patch({ ollamaBaseURL: e.target.value })} />
                </Field>
                <Field label="Reasoning model">
                  <select className="input" value={p.ollamaModelTag} onChange={(e) => patch({ ollamaModelTag: e.target.value })}>
                    <option value={p.ollamaModelTag}>{p.ollamaModelTag}</option>
                    {models.data?.filter((m) => m.name !== p.ollamaModelTag).map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                  </select>
                </Field>
                <Field label="Embedding model">
                  <Input defaultValue={p.ollamaEmbeddingTag} onBlur={(e) => patch({ ollamaEmbeddingTag: e.target.value })} />
                </Field>
              </div>
              {models.data && (
                <div className="mt-2 text-xs text-ink-500">
                  {models.data.length ? `${models.data.length} model(s) installed: ${models.data.map((m) => m.name).join(', ')}` : 'No models found — run `ollama pull qwen2.5:7b` and `ollama pull nomic-embed-text`.'}
                </div>
              )}
            </Card>

            <Card title="Privacy">
              <label className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-ink-200"><ShieldCheck className="h-4 w-4 text-accent-soft" /> Allow cloud routing</span>
                <input type="checkbox" checked={p.privacyAllowCloud} onChange={(e) => patch({ privacyAllowCloud: e.target.checked })} />
              </label>
              <p className="mt-1 text-xs text-ink-500">When off, cloud providers can never resolve — the app is fully offline.</p>
            </Card>

            <Card title="Cloud (optional)">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Provider">
                  <select className="input" value={p.cloudProvider} onChange={(e) => patch({ cloudProvider: e.target.value as Preferences['cloudProvider'] })}>
                    <option value="none">None</option>
                    <option value="anthropic">Anthropic (Claude)</option>
                    <option value="openai">OpenAI</option>
                  </select>
                </Field>
                <Field label="Model">
                  <Input defaultValue={p.cloudModel} onBlur={(e) => patch({ cloudModel: e.target.value })} />
                </Field>
                <Field label="API key">
                  <div className="flex gap-2">
                    <Input type="password" placeholder={p.cloudApiKeySet ? '•••••••• (set)' : 'sk-…'} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                    <Button onClick={() => { km.settings.setCloudKey(apiKey).then(() => { setApiKey(''); providers.reload(); prefs.reload() }) }}>Save</Button>
                  </div>
                </Field>
              </div>
              <p className="mt-1 text-xs text-ink-500">Key stored locally in secrets.json. Only used when privacy gate allows cloud.</p>
            </Card>
          </div>
        )}
      </Scroll>
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
