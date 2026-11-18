import { useState, useEffect, useRef } from 'react'
import {
  X, Globe, Cpu, Database, Check, Save,
  Type, Settings2, ChevronDown, MessageSquare,
  Languages,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import i18n, { normalizeLanguage, type SupportedLanguage } from '../../i18n'
import PromptSettings from './PromptSettings'
import { useThemeStore, FONT_OPTIONS, type FontId } from '../../stores/theme-store'
import { Button } from '../ui/Button'
import ProviderSettings from './ProviderSettings'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { NativeSelect } from '../ui/NativeSelect'
import { cn } from '../../lib/utils'
import { ipc } from '../../services/ipc-client'
import { Switch } from '../ui/Switch'

// 打赏/赞助 图片资源（通过 import 让 Vite 处理路径，确保打包后可正常加载）
import wepayImg from '/buyme/wepay.jpg?url'
import alipayImg from '/buyme/alipay.jpg?url'
import wechatImg from '/buyme/wechat.jpg?url'

// ==================== 分类定义 ====================

type SettingsSection = 'language' | 'llm' | 'embedding' | 'proxy' | 'editor' | 'prompts' | 'about'

interface SectionItem {
  id: SettingsSection
  label: string
  icon: React.ReactNode
  descriptionKey: string
}

const SECTIONS: SectionItem[] = [
  { id: 'language', label: 'Language', icon: <Languages size={16} />, descriptionKey: 'general.languageDesc' },
  { id: 'llm', label: 'AI Models', icon: <Cpu size={16} />, descriptionKey: 'general.llmDesc' },
  { id: 'embedding', label: 'Embedding Models', icon: <Database size={16} />, descriptionKey: 'general.embeddingDesc' },
  { id: 'proxy', label: 'Network Proxy', icon: <Globe size={16} />, descriptionKey: 'general.proxyDesc' },
  { id: 'editor', label: 'Editor', icon: <Type size={16} />, descriptionKey: 'general.editorDesc' },
  { id: 'prompts', label: 'Prompt Templates', icon: <MessageSquare size={16} />, descriptionKey: 'general.promptsDesc' },
  { id: 'about', label: 'About & Support', icon: <span style={{ color: '#ff4d4f', fontSize: 14 }}>❤️</span>, descriptionKey: 'general.aboutDesc' },
]

function getSectionTitleKey(section: SettingsSection): string {
  return section === 'llm' ? 'models' : section
}

// ==================== 主组件 ====================

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

/** 全屏设置弹窗 */
export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { t } = useTranslation('settings')
  const [section, setSection] = useState<SettingsSection>('llm')

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="relative flex w-full max-w-[880px] max-h-[80vh] rounded-2xl overflow-hidden shadow-2xl"
        style={{
          backgroundColor: 'var(--color-editor-bg)',
          border: '1px solid var(--color-border)',
        }}
      >
        {/* 左侧导航 */}
        <aside
          className="flex flex-col w-60 flex-shrink-0 py-5 gap-1"
          style={{
            backgroundColor: 'var(--color-sidebar)',
            borderRight: '1px solid var(--color-border)',
          }}
        >
          {/* 标题 */}
          <div className="flex items-center gap-2 px-4 mb-4">
            <Settings2 size={16} style={{ color: 'var(--color-accent)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
              {t('general.title')}
            </span>
          </div>

          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={cn(
                'flex items-center gap-2.5 mx-2 px-3 py-2.5 rounded-lg text-left text-sm transition-colors min-w-0',
                section === s.id
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]',
              )}
            >
              <span className="flex-shrink-0">{s.icon}</span>
              <span className="truncate">{t(`general.${getSectionTitleKey(s.id)}`)}</span>
            </button>
          ))}
        </aside>

        {/* 右侧内容区 */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* 区域标题栏 */}
          <div
            className="flex items-center justify-between px-6 py-4 flex-shrink-0"
            style={{ borderBottom: '1px solid var(--color-border)' }}
          >
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
                {t(`general.${getSectionTitleKey(section)}`)}
              </h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                {t(SECTIONS.find((s) => s.id === section)?.descriptionKey ?? '')}
              </p>
            </div>
            <button
              onClick={onClose}
              className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors hover:bg-[var(--color-hover)]"
              style={{ color: 'var(--color-text-muted)' }}
            >
              <X size={16} />
            </button>
          </div>

          {/* 区域内容 */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {section === 'language' && <LanguageSection />}
            {section === 'llm' && <ProviderSettings embedding={false} />}
            {section === 'embedding' && <ProviderSettings embedding />}
            {section === 'proxy' && <ProxySection />}
            {section === 'editor' && <EditorSection />}
            {section === 'prompts' && <PromptSettings />}
            {section === 'about' && <AboutSection />}
          </div>
        </main>
      </div>
    </div>
  )
}

// ==================== Language Section ====================

function LanguageSection() {
  const { t } = useTranslation('settings')
  const currentLang = normalizeLanguage(i18n.language)

  const languages: Array<{ code: SupportedLanguage; label: string; nativeLabel: string }> = [
    { code: 'zh-CN', label: '简体中文', nativeLabel: '简体中文' },
    { code: 'en', label: 'English', nativeLabel: 'English' },
    { code: 'ru', label: 'Русский', nativeLabel: 'Русский' },
    { code: 'pt-BR', label: 'Português', nativeLabel: 'Português (Brasil)' },
  ]

  const handleLanguageChange = async (langCode: SupportedLanguage) => {
    await i18n.changeLanguage(langCode)
    localStorage.setItem('vela-locale', langCode)
    ipc.invoke('config:set', { locale: langCode }).catch(() => { })
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>
          {t('language.label')}
        </h3>
        <div className="space-y-2">
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => handleLanguageChange(lang.code)}
              className={cn(
                'flex items-center justify-between w-full px-4 py-3 rounded-lg text-left transition-colors',
                currentLang === lang.code
                  ? 'bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30'
                  : 'border border-[var(--color-border)] hover:bg-[var(--color-hover)]',
              )}
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                  {lang.label}
                </span>
                {lang.label !== lang.nativeLabel && (
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {lang.nativeLabel}
                  </span>
                )}
              </div>
              {currentLang === lang.code && (
                <Check size={16} style={{ color: 'var(--color-accent)' }} />
              )}
            </button>
          ))}
        </div>
        <p className="text-xs mt-3" style={{ color: 'var(--color-text-muted)' }}>
          {t('language.hint')}
        </p>
      </div>
    </div>
  )
}

// ==================== 代理设置 ====================

function ProxySection() {
  const { t } = useTranslation('settings')
  const [proxy, setProxy] = useState<{
    enabled: boolean; type: 'http' | 'socks5'; host: string; port: number
  }>({ enabled: false, type: 'http', host: '', port: 7890 })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    ipc.invoke('config:get').then((cfg) => {
      if (cfg?.proxy) {
        setProxy({
          enabled: cfg.proxy.enabled ?? false, // 明确默认关闭
          type: cfg.proxy.type ?? 'http',
          host: cfg.proxy.host ?? '',
          port: cfg.proxy.port ?? 7890,
        })
      }
    }).catch(() => { })
  }, [])

  const handleSave = async () => {
    setSaving(true)
    await ipc.invoke('config:set', { proxy }).catch(() => { })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="max-w-[480px] space-y-5">
      {/* 启用开关 */}
      <div
        className="flex items-center justify-between p-4 rounded-xl"
        style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}
      >
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{t('models.proxy.enableProxy')}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {t('models.proxy.enableProxyDesc')}
          </p>
        </div>
        <Switch
          checked={proxy.enabled}
          onCheckedChange={(checked) => setProxy({ ...proxy, enabled: checked })}
          aria-label={t('models.proxy.enableProxy')}
        />
      </div>

      {/* 代理详情 */}
      {proxy.enabled && (
        <div
          className="space-y-3 p-4 rounded-xl"
          style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}
        >
          <div>
            <Label>{t('models.proxy.proxyType')}</Label>
            <NativeSelect
              value={proxy.type}
              onChange={(e) => setProxy({ ...proxy, type: e.target.value as 'http' | 'socks5' })}
            >
              <option value="http">HTTP</option>
              <option value="socks5">SOCKS5</option>
            </NativeSelect>
          </div>
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div>
              <Label>{t('models.proxy.proxyHost')}</Label>
              <Input
                value={proxy.host}
                onChange={(e) => setProxy({ ...proxy, host: e.target.value })}
                placeholder="127.0.0.1"
              />
            </div>
            <div>
              <Label>{t('models.proxy.proxyPort')}</Label>
              <Input
                type="number"
                value={proxy.port}
                onChange={(e) => setProxy({ ...proxy, port: (e.target.value === '' ? '' : parseInt(e.target.value)) as number })}
                onBlur={() => {
                  const v = Number(proxy.port);
                  if (!v) setProxy({ ...proxy, port: 7890 })
                }}
              />
            </div>
          </div>
        </div>
      )}

      <Button onClick={handleSave} disabled={saving}>
        {saved ? <Check size={13} /> : <Save size={13} />}
        {saved ? t('models.saved') : saving ? t('models.saving') : t('models.proxy.saveProxy')}
      </Button>
    </div>
  )
}

// ==================== 编辑器设置 ====================

/** 字体下拉菜单（界面字体 + 写作字体共用） */
function FontSelect({
  value,
  onChange,
}: {
  value: FontId
  onChange: (id: FontId) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = FONT_OPTIONS.find((o) => o.id === value) ?? FONT_OPTIONS[0]

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      {/* 触发按鈕 */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full px-3 h-9 rounded-lg transition-colors text-left"
        style={{
          border: '1px solid var(--color-border)',
          backgroundColor: open ? 'var(--color-hover)' : 'var(--color-panel)',
          color: 'var(--color-text)',
        }}
      >
        {/* 当前字体预览 */}
        <span
          className="flex-1 text-sm truncate"
          style={{ fontFamily: current.family }}
        >
          {current.label}
        </span>
        <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
          {current.preview}
        </span>
        <ChevronDown
          size={13}
          className="flex-shrink-0 transition-transform"
          style={{
            color: 'var(--color-text-muted)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        />
      </button>

      {/* 下拉选项列表 */}
      {open && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 rounded-xl overflow-hidden"
          style={{
            border: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-panel)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          {FONT_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => { onChange(opt.id); setOpen(false) }}
              className="w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors hover:bg-[var(--color-hover)]"
              style={{
                backgroundColor: value === opt.id
                  ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)'
                  : 'transparent',
              }}
            >
              {/* 选中标记 */}
              <span
                className="w-3.5 h-3.5 rounded-full flex-shrink-0 flex items-center justify-center"
                style={{
                  backgroundColor: value === opt.id ? 'var(--color-accent)' : 'transparent',
                  border: value === opt.id ? 'none' : '1.5px solid var(--color-border)',
                }}
              >
                {value === opt.id && (
                  <span className="w-1.5 h-1.5 rounded-full bg-white" />
                )}
              </span>

              {/* 字体名 + 描述 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium" style={{ color: 'var(--color-text)', fontFamily: opt.family }}>
                    {opt.label}
                  </span>
                  <span className="text-[0.65rem]" style={{ color: 'var(--color-text-muted)' }}>
                    {opt.labelEn}
                  </span>
                </div>
                <p className="text-[0.65rem] truncate mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                  {opt.desc}
                </p>
              </div>

              {/* 预览文字 */}
              <span
                className="text-sm flex-shrink-0"
                style={{ fontFamily: opt.family, color: 'var(--color-text-secondary)' }}
              >
                {opt.preview}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function EditorSection() {
  const { writingFont, setWritingFont, uiFont, setUiFont } = useThemeStore()
  const { t } = useTranslation('settings')

  return (
    <div className="max-w-md space-y-5">
      {/* 界面字体 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{t('appearance.uiFont')}</p>
            <p className="text-[0.68rem] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              {t('appearance.uiFontDesc')}
            </p>
          </div>
        </div>
        <FontSelect value={uiFont} onChange={setUiFont} />
      </div>

      {/* 写作字体 */}
      <div className="space-y-1.5">
        <div>
          <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{t('appearance.writingFont')}</p>
          <p className="text-[0.68rem] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {t('appearance.writingFontDesc')}
          </p>
        </div>
        <FontSelect value={writingFont} onChange={setWritingFont} />
      </div>

      {/* 说明 */}
      <div
        className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-xs"
        style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-muted)' }}
      >
        <span className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{t('appearance.hint')}</span>
        <span>{t('appearance.fontsBuiltIn')}</span>
      </div>
    </div>
  )
}

// ==================== 关于与支持区 ====================

function AboutSection() {
  const { t } = useTranslation('settings')
  return (
    <div className="space-y-6 max-w-[600px] p-2">
      <div className="flex flex-col items-center justify-center py-8 rounded-xl space-y-2" style={{ backgroundColor: 'var(--color-sidebar)', border: '1px solid var(--color-border)' }}>
        <h1 className="text-2xl font-bold brand-gradient tracking-wider">Vela IDE</h1>
        <p className="text-sm opacity-80" style={{ color: 'var(--color-text)' }}>v{__APP_VERSION__}</p>
        <p className="text-xs mt-2" style={{ color: 'var(--color-text-muted)' }}>Crafted with ❤️ by heider</p>
      </div>

      <div className="space-y-4 pt-2">
        <h3 className="text-sm font-semibold pb-2" style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)' }}>☕ {t('about.sponsorship')}</h3>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
          {t('about.sponsorDescription')}
        </p>
        <div className="flex gap-4 items-center">
          <img src={wepayImg} alt="WeChat Pay" className="w-[180px] rounded-lg" style={{ border: '1px solid var(--color-border)' }} />
          <img src={alipayImg} alt="Alipay" className="w-[180px] rounded-lg" style={{ border: '1px solid var(--color-border)' }} />
        </div>
      </div>

      <div className="space-y-4 pt-4">
        <h3 className="text-sm font-semibold pb-2" style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text)' }}>🤝 {t('about.businessInquiries')}</h3>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
          {t('about.businessDescription')}
        </p>
        <img src={wechatImg} alt="WeChat" className="w-[180px] rounded-lg" style={{ border: '1px solid var(--color-border)' }} />
      </div>
    </div>
  )
}

