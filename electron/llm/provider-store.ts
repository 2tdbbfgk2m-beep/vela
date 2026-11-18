import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ModelProfile, ProviderConfig, ProviderModelEntry } from '../../src/shared/ipc-channels'
import { readJsonFile, writeJsonFile, VELA_HOME } from '../utils/config-utils'

/** 配置目录，测试可替换为临时目录 */
export const providerConfigDir = { current: VELA_HOME }

const providersPath = () => path.join(providerConfigDir.current, 'providers.json')
const legacyModelsPath = () => path.join(providerConfigDir.current, 'models.json')

/**
 * 读取服务商配置。providers.json 不存在时，从旧的 models.json（一份模型一份 Key）迁移：
 * 按 provider + protocol + baseUrl + apiKey 合并，模型条目保留原 id，旧默认模型引用因此仍然有效。
 */
export function loadProviders(): ProviderConfig[] {
  const stored = readJsonFile<ProviderConfig[] | null>(providersPath(), null)
  if (stored) return stored

  const legacy = readJsonFile<ModelProfile[]>(legacyModelsPath(), [])
  const providers = groupLegacyModels(legacy)
  writeJsonFile(providersPath(), providers)
  return providers
}

export function saveProviders(providers: ProviderConfig[]) {
  writeJsonFile(providersPath(), providers)
}

/** 展开成扁平模型列表，供生成、向量检索等现有调用方使用 */
export function expandProfiles(providers: ProviderConfig[]): ModelProfile[] {
  return providers.flatMap((provider) => provider.models.map((entry) => toProfile(provider, entry)))
}

export function toProfile(provider: ProviderConfig, entry: ProviderModelEntry): ModelProfile {
  return {
    id: entry.id,
    name: entry.displayName || entry.modelName,
    provider: provider.provider,
    protocol: provider.protocol,
    modelName: entry.modelName,
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    temperature: entry.temperature,
    maxTokens: entry.maxTokens,
    purposes: entry.purposes,
  }
}

/** 旧格式分组：同一服务商 + 协议 + 地址 + Key 归为一个服务商 */
function groupLegacyModels(models: ModelProfile[]): ProviderConfig[] {
  const groups = new Map<string, ProviderConfig>()
  for (const model of models) {
    const key = [model.provider, model.protocol, model.baseUrl, model.apiKey].join('\n')
    let group = groups.get(key)
    if (!group) {
      group = {
        id: randomUUID(),
        name: model.provider,
        provider: model.provider,
        protocol: model.protocol,
        baseUrl: model.baseUrl,
        apiKey: model.apiKey,
        models: [],
      }
      groups.set(key, group)
    }
    group.models.push({
      id: model.id,
      modelName: model.modelName,
      displayName: model.name || model.modelName,
      temperature: model.temperature,
      maxTokens: model.maxTokens,
      purposes: model.purposes ?? ['generation'],
    })
  }
  return [...groups.values()]
}
