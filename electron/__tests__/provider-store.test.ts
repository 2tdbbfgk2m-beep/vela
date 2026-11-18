import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ModelProfile } from '../../src/shared/ipc-channels'
import { expandProfiles, loadProviders, providerConfigDir, saveProviders } from '../llm/provider-store'

const dirs: string[] = []

function useTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-providers-'))
  dirs.push(dir)
  providerConfigDir.current = dir
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

const legacy = (over: Partial<ModelProfile>): ModelProfile => ({
  id: 'id', name: 'name', provider: 'openai', protocol: 'openai', modelName: 'gpt-4o',
  apiKey: 'sk-1', baseUrl: 'https://api.openai.com', temperature: 0.7, maxTokens: 4096,
  purposes: ['generation'], ...over,
})

describe('provider config migration', () => {
  it('groups legacy per-model configs that share a key into one provider, keeping model ids', () => {
    const dir = useTempDir()
    fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify([
      legacy({ id: 'a', name: '主力', modelName: 'gpt-4o' }),
      legacy({ id: 'b', name: '备用', modelName: 'gpt-4o-mini', temperature: 0.2 }),
      legacy({ id: 'c', provider: 'ollama', modelName: 'qwen2.5', apiKey: '', baseUrl: 'http://localhost:11434' }),
    ]))

    const providers = loadProviders()

    expect(providers).toHaveLength(2)
    const openai = providers.find(p => p.provider === 'openai')!
    expect(openai.models.map(m => m.id)).toEqual(['a', 'b'])
    expect(openai.apiKey).toBe('sk-1')
    expect(openai.models[1]).toMatchObject({ modelName: 'gpt-4o-mini', temperature: 0.2 })
    // 迁移结果落盘，旧文件保留
    expect(fs.existsSync(path.join(dir, 'providers.json'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'models.json'))).toBe(true)
  })

  it('expands a provider back into flat profiles the rest of the app consumes', () => {
    useTempDir()
    saveProviders([{
      id: 'p', name: 'DeepSeek', provider: 'deepseek', protocol: 'openai',
      baseUrl: 'https://api.deepseek.com', apiKey: 'sk-2',
      models: [{ id: 'm', modelName: 'deepseek-chat', displayName: '对话', temperature: 0.5, maxTokens: 8192, purposes: ['generation'] }],
    }])

    const [profile] = expandProfiles(loadProviders())
    expect(profile).toMatchObject({
      id: 'm', name: '对话', provider: 'deepseek', apiKey: 'sk-2',
      baseUrl: 'https://api.deepseek.com', modelName: 'deepseek-chat', maxTokens: 8192,
    })
  })

  it('does not re-migrate once providers.json exists, even if it is empty', () => {
    const dir = useTempDir()
    fs.writeFileSync(path.join(dir, 'providers.json'), '[]')
    fs.writeFileSync(path.join(dir, 'models.json'), JSON.stringify([legacy({})]))
    expect(loadProviders()).toEqual([])
  })
})
