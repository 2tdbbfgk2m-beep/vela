import { listOllamaModels } from './ollama-models'

/**
 * 拉取服务商的可用模型列表。
 * - ollama：复用 /api/tags
 * - gemini 协议：GET {base}/v1beta/models?key=
 * - openai 兼容（openai / deepseek / bigmodel / custom）：GET {base}/v1/models（base 已带版本号则不重复追加）
 * 只接受 http(s) 且不含凭据的地址，超时 10 秒。
 */
export async function listRemoteModels(source: {
  provider: string
  protocol: string
  baseUrl: string
  apiKey: string
}): Promise<string[]> {
  if (source.provider === 'ollama') return listOllamaModels(source.baseUrl, source.apiKey)

  const base = normalizeBase(source.baseUrl)
  const url = source.protocol === 'gemini'
    ? new URL(`${base}/v1beta/models`)
    : new URL(`${versionedBase(base)}/models`)
  if (source.protocol === 'gemini' && source.apiKey) url.searchParams.set('key', source.apiKey)

  const response = await fetch(url, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
    headers: source.protocol === 'gemini'
      ? {}
      : { Authorization: `Bearer ${source.apiKey}` },
  })
  if (!response.ok) throw new Error(`HTTP_${response.status}`)
  const data: unknown = await response.json()

  const raw = source.protocol === 'gemini' ? geminiNames(data) : openAINames(data)
  return [...new Set(raw)].sort((a, b) => a.localeCompare(b))
}

/** 校验并去掉末尾斜杠，拒绝非 http(s) 或带凭据的地址 */
function normalizeBase(baseUrl: string): string {
  let url: URL
  try { url = new URL(baseUrl.trim()) } catch { throw new Error('INVALID_URL') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('INVALID_URL')
  }
  return url.toString().replace(/\/$/, '')
}

/** base 已以 /v数字 结尾则原样返回，否则补 /v1 */
function versionedBase(base: string): string {
  return /\/v\d+$/.test(base) ? base : `${base}/v1`
}

function openAINames(data: unknown): string[] {
  if (!data || typeof data !== 'object' || !('data' in data) || !Array.isArray(data.data)) {
    throw new Error('INVALID_RESPONSE')
  }
  return data.data.map((item: unknown) => {
    if (!item || typeof item !== 'object' || !('id' in item) || typeof item.id !== 'string' || !item.id.trim()) {
      throw new Error('INVALID_RESPONSE')
    }
    return item.id
  })
}

function geminiNames(data: unknown): string[] {
  if (!data || typeof data !== 'object' || !('models' in data) || !Array.isArray(data.models)) {
    throw new Error('INVALID_RESPONSE')
  }
  return data.models.map((item: unknown) => {
    if (!item || typeof item !== 'object' || !('name' in item) || typeof item.name !== 'string') {
      throw new Error('INVALID_RESPONSE')
    }
    // Gemini 返回 "models/gemini-2.5-pro"，去掉前缀
    return item.name.replace(/^models\//, '')
  }).filter((name) => name.trim())
}
