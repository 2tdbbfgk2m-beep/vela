import { ipcMain, BrowserWindow } from 'electron'
import { readJsonFile, writeJsonFile, GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG } from '../utils/config-utils'
import { ModelProfile, GlobalConfig, ProviderConfig } from '../../src/shared/ipc-channels'
import { LLMFactory } from '../llm/llm-factory'
import { listRemoteModels } from '../llm/list-models'
import { loadProviders, saveProviders, expandProfiles } from '../llm/provider-store'

const activeStreams = new Map<string, AbortController>()

function loadModelConfigs(): ModelProfile[] {
  return expandProfiles(loadProviders())
}

function getModelConfig(modelId: string): ModelProfile | null {
  return loadModelConfigs().find((m) => m.id === modelId) ?? null
}

function applyProxyConfig() {
  try {
    const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
    if (config.proxy?.enabled && config.proxy.host) {
      const proxyUrl = config.proxy.type === 'socks5'
        ? `socks5://${config.proxy.host}:${config.proxy.port}`
        : `http://${config.proxy.host}:${config.proxy.port}`
      process.env.HTTP_PROXY = proxyUrl
      process.env.HTTPS_PROXY = proxyUrl
      process.env.http_proxy = proxyUrl
      process.env.https_proxy = proxyUrl
    } else {
      delete process.env.HTTP_PROXY
      delete process.env.HTTPS_PROXY
      delete process.env.http_proxy
      delete process.env.https_proxy
    }
  } catch { /* 忽略 */ }
}

export function registerLLMController() {
  ipcMain.handle('llm:ollama-models', async (_event, baseUrl: string, apiKey?: string) => {
    return fetchModels({ provider: 'ollama', protocol: 'openai', baseUrl, apiKey: apiKey ?? '' })
  })

  ipcMain.handle('llm:list-providers', async () => loadProviders())

  ipcMain.handle('llm:save-provider', async (_event, provider: ProviderConfig) => {
    try {
      const providers = loadProviders()
      const idx = providers.findIndex((p) => p.id === provider.id)
      if (idx >= 0) providers[idx] = provider
      else providers.push(provider)
      saveProviders(providers)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('llm:delete-provider', async (_event, providerId: string) => {
    try {
      saveProviders(loadProviders().filter((p) => p.id !== providerId))
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('llm:fetch-models', async (_event, source: Pick<ProviderConfig, 'provider' | 'protocol' | 'baseUrl' | 'apiKey'>) => {
    return fetchModels(source)
  })
  ipcMain.handle('llm:generate', async (_event, request: { modelId: string; messages: Array<{ role: string; content: string }>; temperature?: number; maxTokens?: number; responseFormat?: { type: string }; thinking?: boolean }) => {
    try {
      applyProxyConfig()
      const model = getModelConfig(request.modelId)
      if (!model) return { success: false, content: '', error: '未找到模型配置' }

      const provider = LLMFactory.getProvider(model)
      return await provider.generate(model, request.messages, {
        temperature: request.temperature ?? model.temperature,
        maxTokens: request.maxTokens ?? model.maxTokens,
        responseFormat: request.responseFormat,
        thinking: request.thinking,
      })
    } catch (error) {
      return { success: false, content: '', error: String(error) }
    }
  })

  ipcMain.handle('llm:generate-stream', async (event, requestId: string, request: { modelId: string; messages: Array<{ role: string; content: string }>; temperature?: number; maxTokens?: number; responseFormat?: { type: string }; thinking?: boolean }) => {
    applyProxyConfig()
    const model = getModelConfig(request.modelId)
    if (!model) return { requestId, started: false }

    const abortController = new AbortController()
    activeStreams.set(requestId, abortController)
    const win = BrowserWindow.fromWebContents(event.sender)

    const provider = LLMFactory.getProvider(model)
    
    // We do not await this globally since it's streaming independently
    provider.generateStream(model, request.messages, {
      temperature: request.temperature ?? model.temperature,
      maxTokens: request.maxTokens ?? model.maxTokens,
      responseFormat: request.responseFormat,
      thinking: request.thinking,
      signal: abortController.signal,
      onChunk: (chunk: string) => win?.webContents.send('llm:stream-chunk', { requestId, chunk }),
      onDone: (fullText: string, usage?: { promptTokens: number; completionTokens: number; totalTokens: number }) => {
        win?.webContents.send('llm:stream-done', { requestId, fullText, usage })
        activeStreams.delete(requestId)
      },
      onError: (error: string) => {
        win?.webContents.send('llm:stream-error', { requestId, error })
        activeStreams.delete(requestId)
      },
    })

    return { requestId, started: true }
  })

  ipcMain.handle('llm:cancel', async (_event, requestId: string) => {
    const controller = activeStreams.get(requestId)
    if (controller) {
      controller.abort()
      activeStreams.delete(requestId)
      return { success: true }
    }
    return { success: false }
  })

  ipcMain.handle('llm:list-models', async () => loadModelConfigs())



  ipcMain.handle('llm:set-default-model', async (_event, modelId: string | null) => {
    try {
      const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
      config.defaultModelId = modelId
      writeJsonFile(GLOBAL_CONFIG_PATH, config)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('llm:get-default-model', async () => {
    const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
    return config.defaultModelId
  })

  ipcMain.handle('llm:set-default-embedding-model', async (_event, modelId: string | null) => {
    try {
      const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
      config.defaultEmbeddingModelId = modelId
      writeJsonFile(GLOBAL_CONFIG_PATH, config)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('llm:get-default-embedding-model', async () => {
    const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
    return config.defaultEmbeddingModelId ?? null
  })

  ipcMain.handle('llm:test-connection', async (_event, model: ModelProfile) => {
    try {
      applyProxyConfig()
      
      const messages = [{ role: 'user', content: 'Say "hello" and nothing else.' }]
      const provider = LLMFactory.getProvider(model)
      
      let result = { success: true, error: undefined as undefined | string }
      if (model.purposes?.includes('embedding')) {
        const { generateEmbeddings } = await import('../embedding')
        await generateEmbeddings(['hello'], model.protocol, model)
      } else {
        const res = await provider.generate(model, messages, {
          temperature: 0.7,
          maxTokens: 10,
        })
        result = { success: res.success, error: res.error }
      }
      
      return { success: result.success, error: result.error }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })
}

/** 拉取模型列表，错误归一化为前端可翻译的错误码 */
async function fetchModels(source: Pick<ProviderConfig, 'provider' | 'protocol' | 'baseUrl' | 'apiKey'>) {
  try {
    return { success: true, models: await listRemoteModels(source) }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const code = /^(INVALID_URL|INVALID_RESPONSE|HTTP_\d+)$/.test(message) ? message :
      error instanceof Error && error.name === 'TimeoutError' ? 'TIMEOUT' : 'CONNECTION_FAILED'
    return { success: false, models: [], error: code }
  }
}
