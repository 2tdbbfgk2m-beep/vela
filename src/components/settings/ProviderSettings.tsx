import { useEffect, useMemo, useState } from 'react'
import { Check, Eye, EyeOff, Plus, RefreshCw, Save, Trash2, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLLMStore } from '../../stores/llm-store'
import { ipc } from '../../services/ipc-client'
import type { ModelProfile, ProviderConfig, ProviderModelEntry } from '../../shared/ipc-channels'
import { BUILTIN_PRESETS } from '../../shared/provider-presets'
import { randomUUID } from '../../utils/id'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { NativeSelect } from '../ui/NativeSelect'

type ProviderKind = ModelProfile['provider']
type Purpose = ModelProfile['purposes'][number]

const PROVIDER_KINDS: ProviderKind[] = ['openai', 'deepseek', 'gemini', 'ollama', 'bigmodel', 'custom']

/** 服务商设置：左侧服务商列表，右侧一份地址与 Key 下挂多个模型 */
export default function ProviderSettings({ embedding }: { embedding: boolean }) {
  const { t } = useTranslation('settings')
  const providers = useLLMStore(s => s.providers)
  const loaded = useLLMStore(s => s.loaded)
  const loadModels = useLLMStore(s => s.loadModels)
  const saveProvider = useLLMStore(s => s.saveProvider)
  const deleteProvider = useLLMStore(s => s.deleteProvider)
  const defaultModelId = useLLMStore(s => s.defaultModelId)
  const defaultEmbeddingModelId = useLLMStore(s => s.defaultEmbeddingModelId)
  const setDefaultModel = useLLMStore(s => s.setDefaultModel)
  const setDefaultEmbeddingModel = useLLMStore(s => s.setDefaultEmbeddingModel)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ProviderConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => { if (!loaded) void loadModels() }, [loaded, loadModels])

  const matches = (entry: ProviderModelEntry) =>
    embedding ? entry.purposes.includes('embedding') : entry.purposes.some(p => p !== 'embedding')
  const visible = providers.filter(p => p.models.some(matches))

  const open = (provider: ProviderConfig) => { setSelectedId(provider.id); setDraft(structuredClone(provider)); setSaveError('') }

  const create = () => {
    const preset = BUILTIN_PRESETS.find(p => p.provider === 'openai')!
    const fresh: ProviderConfig = {
      id: randomUUID(), name: preset.displayName ?? 'OpenAI', provider: 'openai',
      protocol: preset.protocol as ProviderConfig['protocol'], baseUrl: preset.baseUrl, apiKey: '', models: [],
    }
    setSelectedId(null)
    setDraft(fresh)
    setSaveError('')
  }

  const save = async () => {
    if (!draft) return
    setSaving(true)
    setSaveError('')
    const ok = await saveProvider(draft)
    setSaving(false)
    if (!ok) { setSaveError(t('models.saveFailure')); return }
    setSelectedId(draft.id)
  }

  const remove = async (id: string) => {
    if (!await deleteProvider(id)) return
    if (selectedId === id) { setSelectedId(null); setDraft(null) }
  }

  const defaultId = embedding ? defaultEmbeddingModelId : defaultModelId
  const setDefault = embedding ? setDefaultEmbeddingModel : setDefaultModel

  return (
    <div className="flex gap-4 min-h-[420px]">
      <aside className="w-52 flex-shrink-0 flex flex-col gap-2">
        <Button size="sm" onClick={create}><Plus size={13} />{t('providers.add')}</Button>
        {visible.length === 0 && !draft && (
          <p className="text-xs px-1" style={{ color: 'var(--color-text-muted)' }}>{t('providers.empty')}</p>
        )}
        {visible.map(provider => (
          <button key={provider.id} onClick={() => open(provider)}
            className="text-left px-3 py-2 rounded-lg border text-sm truncate"
            style={{
              borderColor: selectedId === provider.id ? 'var(--color-accent)' : 'var(--color-border)',
              backgroundColor: 'var(--color-panel)', color: 'var(--color-text)',
            }}>
            <span className="block truncate font-medium">{provider.name || providerLabel(provider.provider, t)}</span>
            <span className="block text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
              {t('providers.modelCount', { count: provider.models.filter(matches).length })}
            </span>
          </button>
        ))}
      </aside>

      <div className="flex-1 min-w-0">
        {saveError && <p role="alert" className="text-sm mb-2 text-[var(--color-error)]">{saveError}</p>}
        {draft ? (
          <ProviderEditor
            draft={draft} embedding={embedding} defaultId={defaultId} saving={saving}
            onChange={setDraft} onSave={save}
            onSetDefault={setDefault}
            onDelete={selectedId ? () => remove(selectedId) : undefined}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {t('providers.pickOrCreate')}
          </div>
        )}
      </div>
    </div>
  )
}

function ProviderEditor({
  draft, embedding, defaultId, saving, onChange, onSave, onSetDefault, onDelete,
}: {
  draft: ProviderConfig
  embedding: boolean
  defaultId: string | null
  saving: boolean
  onChange: (next: ProviderConfig) => void
  onSave: () => void
  onSetDefault: (id: string) => void
  onDelete?: () => void
}) {
  const { t } = useTranslation('settings')
  const testConnection = useLLMStore(s => s.testConnection)
  const [showKey, setShowKey] = useState(false)
  const [fetched, setFetched] = useState<string[]>([])
  const [fetchState, setFetchState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [fetchError, setFetchError] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; error?: string } | null>(null)

  const preset = BUILTIN_PRESETS.find(p => p.provider === draft.provider)
  const presetNames = embedding ? (preset?.embeddingModels ?? []) : (preset?.models.map(m => m.name) ?? [])

  const changeKind = (kind: ProviderKind) => {
    const next = BUILTIN_PRESETS.find(p => p.provider === kind)
    setFetched([]); setFetchState('idle'); setPicked(new Set())
    onChange({
      ...draft, provider: kind,
      protocol: (next?.protocol ?? 'openai') as ProviderConfig['protocol'],
      baseUrl: next?.baseUrl ?? '',
      apiKey: kind === 'ollama' ? '' : draft.apiKey,
      name: draft.name || next?.displayName || kind,
    })
  }

  const fetchModels = async () => {
    setFetchState('loading'); setFetchError(''); setFetched([])
    const result = await ipc.invoke('llm:fetch-models', {
      provider: draft.provider, protocol: draft.protocol, baseUrl: draft.baseUrl, apiKey: draft.apiKey,
    })
    if (!result.success) { setFetchState('error'); setFetchError(result.error ?? 'CONNECTION_FAILED'); return }
    setFetched(result.models); setFetchState('done'); setPicked(new Set())
  }

  const shown = useMemo(
    () => fetched.filter(name => name.toLowerCase().includes(filter.trim().toLowerCase())),
    [fetched, filter],
  )

  const addPicked = () => {
    const existing = new Set(draft.models.map(m => m.modelName))
    const additions: ProviderModelEntry[] = [...picked]
      .filter(name => !existing.has(name))
      .map(name => ({
        id: randomUUID(), modelName: name, displayName: name,
        temperature: 0.7,
        maxTokens: preset?.models.find(m => m.name === name)?.maxTokens ?? 4096,
        purposes: (embedding ? ['embedding'] : ['generation']) as Purpose[],
      }))
    if (additions.length) onChange({ ...draft, models: [...draft.models, ...additions] })
    setPicked(new Set())
  }

  const addManual = (name: string) => {
    const trimmed = name.trim()
    if (!trimmed || draft.models.some(m => m.modelName === trimmed)) return
    onChange({
      ...draft, models: [...draft.models, {
        id: randomUUID(), modelName: trimmed, displayName: trimmed, temperature: 0.7,
        maxTokens: preset?.models.find(m => m.name === trimmed)?.maxTokens ?? 4096,
        purposes: (embedding ? ['embedding'] : ['generation']) as Purpose[],
      }],
    })
  }

  const patchEntry = (id: string, patch: Partial<ProviderModelEntry>) =>
    onChange({ ...draft, models: draft.models.map(m => m.id === id ? { ...m, ...patch } : m) })

  const test = async (entry: ProviderModelEntry) => {
    setTesting(entry.id); setTestResult(null)
    const profile: ModelProfile = {
      id: entry.id, name: entry.displayName, provider: draft.provider, protocol: draft.protocol,
      modelName: entry.modelName, apiKey: draft.apiKey, baseUrl: draft.baseUrl,
      temperature: entry.temperature, maxTokens: entry.maxTokens, purposes: entry.purposes,
    }
    const result = await testConnection(profile)
    setTesting(null)
    setTestResult({ id: entry.id, ok: result.success, error: result.error })
  }

  const visibleEntries = draft.models.filter(m =>
    embedding ? m.purposes.includes('embedding') : m.purposes.some(p => p !== 'embedding'))
  const canSave = Boolean(draft.baseUrl.trim()) && (draft.provider === 'ollama' || Boolean(draft.apiKey.trim()))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{t('providers.name')}</Label>
          <Input value={draft.name} onChange={e => onChange({ ...draft, name: e.target.value })} />
        </div>
        <div>
          <Label>{t('models.provider')}</Label>
          <NativeSelect aria-label={t('models.provider')} value={draft.provider} onChange={e => changeKind(e.target.value as ProviderKind)}>
            {PROVIDER_KINDS.map(kind => <option key={kind} value={kind}>{providerLabel(kind, t)}</option>)}
          </NativeSelect>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{t('models.protocol')}</Label>
          <NativeSelect value={draft.protocol} onChange={e => onChange({ ...draft, protocol: e.target.value as ProviderConfig['protocol'] })}>
            <option value="openai">{t('models.protocolOpenAI')}</option>
            <option value="gemini">Gemini</option>
          </NativeSelect>
        </div>
        <div>
          <Label>{t('models.baseUrl')}</Label>
          <Input aria-label={t('models.baseUrl')} value={draft.baseUrl} onChange={e => onChange({ ...draft, baseUrl: e.target.value })}
            placeholder={t('models.baseUrlPlaceholder')} />
        </div>
      </div>

      <div>
        <Label>{t('models.apiKey')}</Label>
        <div className="relative">
          <Input type={showKey ? 'text' : 'password'} value={draft.apiKey} className="pr-9"
            onChange={e => onChange({ ...draft, apiKey: e.target.value })}
            placeholder={draft.provider === 'ollama' ? t('models.apiKeyOllamaPlaceholder') : t('models.apiKeyPlaceholder')} />
          <button type="button" onClick={() => setShowKey(!showKey)} aria-label={t('providers.toggleKey')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]">
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>

      {/* 拉取模型 */}
      <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{t('providers.fetch')}</span>
          <Button size="sm" variant="outline" onClick={fetchModels} disabled={fetchState === 'loading' || !draft.baseUrl.trim()}>
            <RefreshCw size={13} className={fetchState === 'loading' ? 'animate-spin' : ''} />
            {fetchState === 'loading' ? t('providers.fetching') : t('providers.fetch')}
          </Button>
        </div>
        {fetchState === 'error' && <p role="alert" className="text-xs text-[var(--color-error)] break-words">{t('providers.fetchFailed', { error: fetchError })}</p>}
        {fetchState === 'done' && fetched.length === 0 && <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('providers.fetchEmpty')}</p>}
        {fetched.length > 0 && (
          <>
            <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder={t('providers.filter')} aria-label={t('providers.filter')} />
            <div className="max-h-40 overflow-y-auto rounded border" style={{ borderColor: 'var(--color-border)' }}>
              {shown.map(name => (
                <label key={name} className="flex items-center gap-2 px-2 py-1 text-xs cursor-pointer hover:bg-[var(--color-hover)]">
                  <input type="checkbox" checked={picked.has(name)} onChange={() => setPicked(prev => {
                    const next = new Set(prev)
                    if (next.has(name)) next.delete(name)
                    else next.add(name)
                    return next
                  })} />
                  <span className="truncate" style={{ color: 'var(--color-text)' }}>{name}</span>
                </label>
              ))}
            </div>
            <Button size="sm" variant="outline" onClick={addPicked} disabled={picked.size === 0}>
              <Plus size={13} />{t('providers.addSelected', { count: picked.size })}
            </Button>
          </>
        )}
        <ManualAdd names={presetNames} onAdd={addManual} />
      </div>

      {/* 已添加的模型 */}
      <div className="space-y-2">
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
          {t('providers.added', { count: visibleEntries.length })}
        </span>
        {visibleEntries.map(entry => (
          <div key={entry.id} className="rounded-lg border p-2 space-y-2" style={{ borderColor: defaultId === entry.id ? 'var(--color-accent)' : 'var(--color-border)' }}>
            <div className="flex items-center gap-2">
              <Input className="h-7 text-xs flex-1" aria-label={t('models.displayName')} value={entry.displayName}
                onChange={e => patchEntry(entry.id, { displayName: e.target.value })} />
              <span className="text-xs truncate max-w-40" style={{ color: 'var(--color-text-muted)' }}>{entry.modelName}</span>
              {defaultId === entry.id
                ? <span className="text-[0.7rem] px-1.5 py-0.5 rounded-full bg-[var(--color-accent)] text-white">{t('models.default')}</span>
                : <Button variant="ghost" size="icon" title={t('models.setDefault')} onClick={() => onSetDefault(entry.id)}><Check size={14} /></Button>}
              <Button variant="ghost" size="icon" title={t('models.removeModel')} className="hover:text-red-400"
                onClick={() => onChange({ ...draft, models: draft.models.filter(m => m.id !== entry.id) })}><Trash2 size={14} /></Button>
            </div>
            {!embedding && (
              <div className="grid grid-cols-2 gap-2">
                <Input aria-label={t('models.temperature')} value={String(entry.temperature)}
                  onChange={e => patchEntry(entry.id, { temperature: (e.target.value === '' ? '' : parseFloat(e.target.value)) as number })}
                  onBlur={() => { if (Number.isNaN(Number(entry.temperature))) patchEntry(entry.id, { temperature: 0.7 }) }} />
                <Input aria-label={t('models.maxTokens')} value={String(entry.maxTokens)}
                  onChange={e => patchEntry(entry.id, { maxTokens: (e.target.value === '' ? '' : parseInt(e.target.value)) as number })}
                  onBlur={() => { if (!Number(entry.maxTokens) || Number(entry.maxTokens) < 1) patchEntry(entry.id, { maxTokens: 4096 }) }} />
              </div>
            )}
            <Button variant="outline" size="sm" onClick={() => test(entry)} disabled={testing === entry.id || !canSave}>
              <Zap size={13} />{testing === entry.id ? t('models.testing') : t('models.testConnection')}
            </Button>
            {testResult?.id === entry.id && (
              <p role="status" className={`text-xs break-words ${testResult.ok ? 'text-green-500' : 'text-[var(--color-error)]'}`}>
                {testResult.ok ? t('models.connectionSuccess') : t('models.connectionFailed', { error: testResult.error })}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button className="flex-1" onClick={onSave} disabled={saving || !canSave}>
          <Save size={13} />{saving ? t('models.saving') : t('models.saveConfig')}
        </Button>
        {onDelete && <Button variant="ghost" onClick={onDelete} className="hover:text-red-400"><Trash2 size={13} />{t('providers.remove')}</Button>}
      </div>
    </div>
  )
}

/** 手输模型名，附带预设建议 */
function ManualAdd({ names, onAdd }: { names: string[]; onAdd: (name: string) => void }) {
  const { t } = useTranslation('settings')
  const [value, setValue] = useState('')
  const submit = () => { onAdd(value); setValue('') }
  return (
    <div className="flex items-center gap-2">
      <Input list="provider-preset-models" className="h-7 text-xs flex-1" value={value}
        aria-label={t('providers.manual')} placeholder={t('providers.manual')}
        onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit() }} />
      <datalist id="provider-preset-models">{names.map(name => <option key={name} value={name} />)}</datalist>
      <Button size="sm" variant="outline" onClick={submit} disabled={!value.trim()}><Plus size={13} /></Button>
    </div>
  )
}

function providerLabel(kind: string, t: (key: string) => string): string {
  const fixed: Record<string, string> = { openai: 'OpenAI', deepseek: 'DeepSeek', gemini: 'Google Gemini' }
  return fixed[kind] ?? t(`modelsProviders.${kind}`)
}
