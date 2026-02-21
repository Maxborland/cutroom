import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { api } from '../lib/api'
import {
  Key,
  Wand2,
  Save,
  Loader2,
  CheckCircle2,
  Sparkles,
  Maximize2,
  Film,
  Crown,
  RefreshCw,
  AlertTriangle,
  LayoutGrid,
} from 'lucide-react'
import { ModelSelect } from './ModelSelect'

const SIZE_OPTIONS = [
  { value: 'auto', label: 'Auto (модель выбирает)' },
  { value: '1024x1024', label: '1024×1024' },
  { value: '1536x1024', label: '1536×1024 (ландшафт)' },
  { value: '1024x1536', label: '1024×1536 (портрет)' },
]

const QUALITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High (4K)' },
]

const ASPECT_RATIO_OPTIONS = [
  { value: '16:9', label: '16:9 (ландшафт)' },
  { value: '9:16', label: '9:16 (портрет)' },
  { value: '1:1', label: '1:1 (квадрат)' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
]

const SECTIONS = [
  { id: 'api', label: 'Ключи и LLM', icon: <Key size={14} /> },
  { id: 'generation', label: 'Генерация медиа', icon: <Film size={14} /> },
  { id: 'quality', label: 'Размер и качество', icon: <Maximize2 size={14} /> },
  { id: 'director', label: 'Креативный директор', icon: <Crown size={14} /> },
  { id: 'prompts', label: 'Мастер-промпты', icon: <Wand2 size={14} /> },
] as const

type VideoModelOption = {
  id: string
  name: string
  videoQualityOptions?: string[]
  videoQualitySupport?: 'explicit' | 'none'
}

function normalizeVideoQualityValue(rawQuality: string, model?: VideoModelOption): string {
  const modelOptions = model?.videoQualityOptions || []
  const hasExplicitSupport = model?.videoQualitySupport === 'explicit' && modelOptions.length > 0

  if (!hasExplicitSupport) return 'auto'

  const normalizedQuality = rawQuality.trim()
  if (!normalizedQuality) return modelOptions[modelOptions.length - 1]

  const exact = modelOptions.find((value) => value.toLowerCase() === normalizedQuality.toLowerCase())
  if (exact) return exact

  const lowered = normalizedQuality.toLowerCase()
  if (lowered === 'low') return modelOptions[0]
  if (lowered === 'medium') return modelOptions[Math.floor((modelOptions.length - 1) / 2)]
  if (lowered === 'high') return modelOptions[modelOptions.length - 1]

  return modelOptions[modelOptions.length - 1]
}

function SettingsSection({
  id,
  icon,
  title,
  subtitle,
  children,
}: {
  id: string
  icon: ReactNode
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <section id={id} className="brutal-card bg-surface-1 p-5 sm:p-6 relative overflow-hidden">
      <div className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-amber-glow" />
      <div className="relative">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-amber">{icon}</span>
          <h2 className="font-heading font-semibold text-base sm:text-lg">{title}</h2>
        </div>
        {subtitle && <p className="text-xs sm:text-sm text-text-muted mb-4">{subtitle}</p>}
        {children}
      </div>
    </section>
  )
}

export function SettingsView() {
  const [apiKey, setApiKey] = useState('')
  const [falKey, setFalKey] = useState('')
  const [replicateToken, setReplicateToken] = useState('')
  const [textModel, setTextModel] = useState('openai/gpt-4o')
  const [describeModel, setDescribeModel] = useState('openai/gpt-4o')
  const [scriptModel, setScriptModel] = useState('openai/gpt-4o')
  const [shotSplitModel, setShotSplitModel] = useState('openai/gpt-4o')
  const [reviewModel, setReviewModel] = useState('openai/gpt-4o')
  const [imageModel, setImageModel] = useState('openai/gpt-image-1')
  const [enhanceModel, setEnhanceModel] = useState('openai/gpt-image-1')
  const [imageGenModel, setImageGenModel] = useState('fal/flux-kontext-max')
  const [videoGenModel, setVideoGenModel] = useState('fal/kling-2.1-pro')
  const [audioGenModel, setAudioGenModel] = useState('fal/minimax/speech-02-hd')
  const [imageAspectRatio, setImageAspectRatio] = useState('16:9')
  const [imageSize, setImageSize] = useState('auto')
  const [imageQuality, setImageQuality] = useState('high')
  const [videoQuality, setVideoQuality] = useState('high')
  const [enhanceSize, setEnhanceSize] = useState('auto')
  const [enhanceQuality, setEnhanceQuality] = useState('high')
  const [scriptPrompt, setScriptPrompt] = useState('')
  const [splitterPrompt, setSplitterPrompt] = useState('')
  const [directorModel, setDirectorModel] = useState('openai/gpt-4o')
  const [directorPrompt, setDirectorPrompt] = useState('')
  const [enhancePrompt, setEnhancePrompt] = useState('')
  const [describePrompt, setDescribePrompt] = useState('')
  const [imageGenPrompt, setImageGenPrompt] = useState('')

  const [textModels, setTextModels] = useState<{ id: string; name: string }[]>([])
  const [imageModels, setImageModels] = useState<{ id: string; name: string }[]>([])
  const [imageGenModels, setImageGenModels] = useState<{ id: string; name: string }[]>([])
  const [videoGenModels, setVideoGenModels] = useState<VideoModelOption[]>([])
  const [audioGenModels, setAudioGenModels] = useState<{ id: string; name: string }[]>([])

  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clearMaskedValue = (value: string, setter: (value: string) => void) => {
    if (value.startsWith('••••')) setter('')
  }

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const loadModels = useCallback(async () => {
    setModelsLoading(true)
    setModelsError(null)
    try {
      const { textModels, imageModels, imageGenModels, videoGenModels, audioGenModels } = await api.models.list()
      setTextModels(textModels || [])
      setImageModels(imageModels || [])
      setImageGenModels(imageGenModels || [])
      setVideoGenModels(videoGenModels || [])
      setAudioGenModels(audioGenModels || [])
    } catch (e: any) {
      setModelsError(e?.message || 'Не удалось загрузить список моделей')
      setTextModels([])
      setImageModels([])
      setImageGenModels([])
      setVideoGenModels([])
      setAudioGenModels([])
    } finally {
      setModelsLoading(false)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    api.settings
      .get()
      .then((settings) => {
        if (settings.openRouterApiKey) setApiKey(settings.openRouterApiKey)
        if (settings.falApiKey) setFalKey(settings.falApiKey)
        if (settings.replicateApiToken) setReplicateToken(settings.replicateApiToken)
        if (settings.defaultTextModel) setTextModel(settings.defaultTextModel)
        if (settings.defaultDescribeModel) setDescribeModel(settings.defaultDescribeModel)
        if (settings.defaultScriptModel) setScriptModel(settings.defaultScriptModel)
        if (settings.defaultShotSplitModel) setShotSplitModel(settings.defaultShotSplitModel)
        if (settings.defaultReviewModel) setReviewModel(settings.defaultReviewModel)
        if (settings.defaultImageModel) setImageModel(settings.defaultImageModel)
        if (settings.defaultEnhanceModel) setEnhanceModel(settings.defaultEnhanceModel)
        if (settings.defaultImageGenModel) setImageGenModel(settings.defaultImageGenModel)
        if (settings.defaultVideoGenModel) setVideoGenModel(settings.defaultVideoGenModel)
        if (settings.defaultAudioGenModel) setAudioGenModel(settings.defaultAudioGenModel)
        if (settings.imageAspectRatio) setImageAspectRatio(settings.imageAspectRatio)
        if (settings.imageSize) setImageSize(settings.imageSize)
        if (settings.imageQuality) setImageQuality(settings.imageQuality)
        if (settings.videoQuality) setVideoQuality(settings.videoQuality)
        if (settings.enhanceSize) setEnhanceSize(settings.enhanceSize)
        if (settings.enhanceQuality) setEnhanceQuality(settings.enhanceQuality)
        if (settings.masterPromptScriptwriter) setScriptPrompt(settings.masterPromptScriptwriter)
        if (settings.masterPromptShotSplitter) setSplitterPrompt(settings.masterPromptShotSplitter)
        if (settings.defaultDirectorModel) setDirectorModel(settings.defaultDirectorModel)
        if (settings.masterPromptDirector) setDirectorPrompt(settings.masterPromptDirector)
        if (settings.masterPromptEnhance) setEnhancePrompt(settings.masterPromptEnhance)
        if (settings.masterPromptDescribe) setDescribePrompt(settings.masterPromptDescribe)
        if (settings.masterPromptImageGen) setImageGenPrompt(settings.masterPromptImageGen)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    void loadModels()
  }, [loadModels])

  useEffect(() => {
    const selected = videoGenModels.find((model) => model.id === videoGenModel)
    const normalized = normalizeVideoQualityValue(videoQuality, selected)
    if (normalized !== videoQuality) setVideoQuality(normalized)
  }, [videoGenModel, videoGenModels, videoQuality])

  const selectedVideoModel = videoGenModels.find((model) => model.id === videoGenModel)
  const modelVideoQualityOptions = selectedVideoModel?.videoQualityOptions || []
  const hasModelVideoQualityOptions =
    selectedVideoModel?.videoQualitySupport === 'explicit' && modelVideoQualityOptions.length > 0

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)

    try {
      const normalizedVideoQuality = normalizeVideoQualityValue(videoQuality, selectedVideoModel)
      await api.settings.update({
        openRouterApiKey: apiKey,
        falApiKey: falKey,
        replicateApiToken: replicateToken,
        defaultTextModel: textModel,
        defaultDescribeModel: describeModel,
        defaultScriptModel: scriptModel,
        defaultShotSplitModel: shotSplitModel,
        defaultReviewModel: reviewModel,
        defaultImageModel: imageModel,
        defaultEnhanceModel: enhanceModel,
        defaultImageGenModel: imageGenModel,
        defaultVideoGenModel: videoGenModel,
        defaultAudioGenModel: audioGenModel,
        imageAspectRatio,
        imageSize,
        imageQuality,
        videoQuality: normalizedVideoQuality,
        enhanceSize,
        enhanceQuality,
        defaultDirectorModel: directorModel,
        masterPromptDirector: directorPrompt,
        masterPromptScriptwriter: scriptPrompt,
        masterPromptShotSplitter: splitterPrompt,
        masterPromptEnhance: enhancePrompt,
        masterPromptDescribe: describePrompt,
        masterPromptImageGen: imageGenPrompt,
      })
      if (normalizedVideoQuality !== videoQuality) setVideoQuality(normalizedVideoQuality)
      await loadModels()
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={24} className="text-amber animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        {error && (
          <div className="brutal-card bg-rose-dim border-rose px-4 py-3 text-sm text-rose flex items-start gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-6 h-fit brutal-card bg-surface-2 p-4 space-y-3">
            <div>
              <p className="font-heading text-sm font-semibold mb-1">Настройки пайплайна</p>
              <p className="text-[11px] text-text-muted leading-relaxed">
                Модели, параметры генерации и системные промпты.
              </p>
            </div>
            <div className="space-y-1">
              {SECTIONS.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => scrollToSection(section.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left rounded-[5px] hover:bg-surface-3 text-xs text-text-secondary hover:text-text-primary transition-colors"
                >
                  {section.icon}
                  <span>{section.label}</span>
                </button>
              ))}
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-[5px] bg-amber text-black text-xs font-bold uppercase brutal-btn disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
            {saved && (
              <p className="flex items-center gap-1.5 text-emerald text-xs font-bold">
                <CheckCircle2 size={12} /> Сохранено
              </p>
            )}
          </aside>

          <div className="space-y-6">
            <SettingsSection
              id="api"
              icon={<Key size={14} />}
              title="Ключи и текстовые модели"
              subtitle="OpenRouter используется для сценария, описаний, ревью и режиссёрского анализа."
            >
              <div>
                <label htmlFor="openrouter-api-key" className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1">
                  OpenRouter API Key
                </label>
                <input
                  id="openrouter-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onFocus={() => clearMaskedValue(apiKey, setApiKey)}
                  placeholder="sk-or-..."
                  className="w-full brutal-input px-4 py-2.5 text-sm font-mono"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <ModelSelect
                  label="Описание ассетов (vision)"
                  value={describeModel}
                  onChange={setDescribeModel}
                  models={textModels}
                  loading={modelsLoading}
                  placeholder="openai/gpt-4o"
                />
                <ModelSelect
                  label="Генерация сценария"
                  value={scriptModel}
                  onChange={setScriptModel}
                  models={textModels}
                  loading={modelsLoading}
                  placeholder="openai/gpt-4o"
                />
                <ModelSelect
                  label="Разбивка на шоты"
                  value={shotSplitModel}
                  onChange={setShotSplitModel}
                  models={textModels}
                  loading={modelsLoading}
                  placeholder="openai/gpt-4o"
                />
                <ModelSelect
                  label="AI-ревью шотов"
                  value={reviewModel}
                  onChange={setReviewModel}
                  models={textModels}
                  loading={modelsLoading}
                  placeholder="openai/gpt-4o"
                />
                <ModelSelect
                  label="Базовая text-модель"
                  value={textModel}
                  onChange={setTextModel}
                  models={textModels}
                  loading={modelsLoading}
                  placeholder="openai/gpt-4o"
                />
                <ModelSelect
                  label="Базовая image-модель"
                  value={imageModel}
                  onChange={setImageModel}
                  models={imageModels}
                  loading={modelsLoading}
                  placeholder="openai/gpt-image-1"
                />
              </div>
            </SettingsSection>

            <SettingsSection
              id="generation"
              icon={<Film size={14} />}
              title="Генерация изображений и видео"
              subtitle="Провайдер выбирается автоматически по выбранной модели."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="fal-api-key" className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1">
                    fal.ai API Key
                  </label>
                  <input
                    id="fal-api-key"
                    type="password"
                    value={falKey}
                    onChange={(e) => setFalKey(e.target.value)}
                    onFocus={() => clearMaskedValue(falKey, setFalKey)}
                    placeholder="fal_..."
                    className="w-full brutal-input px-3 py-2.5 text-sm font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="replicate-api-token" className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1">
                    Replicate API Token
                  </label>
                  <input
                    id="replicate-api-token"
                    type="password"
                    value={replicateToken}
                    onChange={(e) => setReplicateToken(e.target.value)}
                    onFocus={() => clearMaskedValue(replicateToken, setReplicateToken)}
                    placeholder="r8_..."
                    className="w-full brutal-input px-3 py-2.5 text-sm font-mono"
                  />
                </div>
              </div>

              <div className="brutal-card bg-surface-2 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="inline-flex items-center gap-1 rounded-[3px] border border-border px-2 py-1 text-text-secondary">
                    <LayoutGrid size={11} />
                    Модели: {textModels.length + imageModels.length + imageGenModels.length + videoGenModels.length + audioGenModels.length}
                  </span>
                  {modelsLoading && (
                    <span className="inline-flex items-center gap-1 rounded-[3px] border border-amber px-2 py-1 text-amber">
                      <Loader2 size={11} className="animate-spin" /> Обновляем список
                    </span>
                  )}
                  {modelsError && (
                    <button
                      type="button"
                      onClick={() => void loadModels()}
                      className="inline-flex items-center gap-1 rounded-[3px] border border-rose px-2 py-1 text-rose hover:bg-rose-dim"
                    >
                      <RefreshCw size={11} /> Повторить загрузку
                    </button>
                  )}
                </div>
                {modelsError && <p className="text-[11px] text-rose mt-2">{modelsError}</p>}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <ModelSelect
                  label="Модель генерации изображений"
                  value={imageGenModel}
                  onChange={setImageGenModel}
                  models={imageGenModels}
                  loading={modelsLoading}
                  placeholder="fal/flux-kontext-max"
                />
                <ModelSelect
                  label="Модель генерации видео"
                  value={videoGenModel}
                  onChange={setVideoGenModel}
                  models={videoGenModels}
                  loading={modelsLoading}
                  placeholder="fal/kling-2.1-pro"
                />
                <ModelSelect
                  label="Модель Enhance"
                  value={enhanceModel}
                  onChange={setEnhanceModel}
                  models={imageModels}
                  loading={modelsLoading}
                  placeholder="openai/gpt-image-1"
                />
                <ModelSelect
                  label="Модель генерации аудио"
                  value={audioGenModel}
                  onChange={setAudioGenModel}
                  models={audioGenModels}
                  loading={modelsLoading}
                  placeholder="fal/minimax/speech-02-hd"
                />
              </div>
            </SettingsSection>

            <SettingsSection
              id="quality"
              icon={<Maximize2 size={14} />}
              title="Размер и качество"
              subtitle="Для видео качество доступно только если модель явно отдала поддерживаемые разрешения через API."
            >
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label htmlFor="image-size" className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
                    Размер генерации
                  </label>
                  <select
                    id="image-size"
                    value={imageSize}
                    onChange={(e) => setImageSize(e.target.value)}
                    className="w-full brutal-input px-3 py-2 text-sm"
                  >
                    {SIZE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="image-quality" className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
                    Качество генерации
                  </label>
                  <select
                    id="image-quality"
                    value={imageQuality}
                    onChange={(e) => setImageQuality(e.target.value)}
                    className="w-full brutal-input px-3 py-2 text-sm"
                  >
                    {QUALITY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="image-aspect-ratio" className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
                    Соотношение сторон
                  </label>
                  <select
                    id="image-aspect-ratio"
                    value={imageAspectRatio}
                    onChange={(e) => setImageAspectRatio(e.target.value)}
                    className="w-full brutal-input px-3 py-2 text-sm"
                  >
                    {ASPECT_RATIO_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="video-quality" className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
                    Качество видео
                  </label>
                  <select
                    id="video-quality"
                    value={videoQuality}
                    onChange={(e) => setVideoQuality(e.target.value)}
                    className="w-full brutal-input px-3 py-2 text-sm"
                    disabled={!hasModelVideoQualityOptions}
                  >
                    {hasModelVideoQualityOptions
                      ? modelVideoQualityOptions.map((value) => (
                          <option key={value} value={value}>{value}</option>
                        ))
                      : <option value="auto">Нет доступных resolution-опций</option>}
                  </select>
                  {!hasModelVideoQualityOptions && (
                    <p className="text-[10px] text-text-muted mt-1">
                      У выбранной видео-модели API не вернуло поддерживаемые разрешения.
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="enhance-size" className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
                    Размер Enhance
                  </label>
                  <select
                    id="enhance-size"
                    value={enhanceSize}
                    onChange={(e) => setEnhanceSize(e.target.value)}
                    className="w-full brutal-input px-3 py-2 text-sm"
                  >
                    {SIZE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="enhance-quality" className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
                    Качество Enhance
                  </label>
                  <select
                    id="enhance-quality"
                    value={enhanceQuality}
                    onChange={(e) => setEnhanceQuality(e.target.value)}
                    className="w-full brutal-input px-3 py-2 text-sm"
                  >
                    {QUALITY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </SettingsSection>

            <SettingsSection
              id="director"
              icon={<Crown size={14} />}
              title="Креативный директор"
              subtitle="Модель и стиль ревью для сценария, шотов и изображений."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <ModelSelect
                  label="Модель директора"
                  value={directorModel}
                  onChange={setDirectorModel}
                  models={textModels}
                  loading={modelsLoading}
                  placeholder="openai/gpt-4o"
                />
              </div>
              <div className="mt-4">
                <label htmlFor="director-prompt" className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
                  Промпт директора
                </label>
                <textarea
                  id="director-prompt"
                  value={directorPrompt}
                  onChange={(e) => setDirectorPrompt(e.target.value)}
                  rows={5}
                  placeholder="Персона, критерии оценки и стиль обратной связи..."
                  className="w-full brutal-input px-4 py-3 text-sm resize-y leading-relaxed min-h-[110px]"
                />
              </div>
            </SettingsSection>

            <SettingsSection
              id="prompts"
              icon={<Sparkles size={14} />}
              title="Мастер-промпты"
              subtitle="Глобальные шаблоны для генерации и постобработки."
            >
              <div className="space-y-4">
                <div>
                  <label htmlFor="describe-prompt" className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
                    Промпт описания ассетов
                  </label>
                  <textarea
                    id="describe-prompt"
                    value={describePrompt}
                    onChange={(e) => setDescribePrompt(e.target.value)}
                    rows={5}
                    placeholder="Инструкция для vision-модели, которая описывает референсы..."
                    className="w-full brutal-input px-4 py-3 text-sm resize-y leading-relaxed min-h-[120px]"
                  />
                </div>

                <div>
                  <label htmlFor="script-prompt" className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
                    Промпт сценариста
                  </label>
                  <textarea
                    id="script-prompt"
                    value={scriptPrompt}
                    onChange={(e) => setScriptPrompt(e.target.value)}
                    rows={5}
                    placeholder="Инструкция для генерации сценария из брифа..."
                    className="w-full brutal-input px-4 py-3 text-sm resize-y leading-relaxed min-h-[120px]"
                  />
                </div>

                <div>
                  <label htmlFor="splitter-prompt" className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
                    Промпт разбивки на шоты
                  </label>
                  <textarea
                    id="splitter-prompt"
                    value={splitterPrompt}
                    onChange={(e) => setSplitterPrompt(e.target.value)}
                    rows={5}
                    placeholder="Как нарезать сценарий на шоты и формировать image/video prompts..."
                    className="w-full brutal-input px-4 py-3 text-sm resize-y leading-relaxed min-h-[120px]"
                  />
                </div>

                <div>
                  <label htmlFor="image-gen-prompt" className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
                    Промпт генерации изображений
                  </label>
                  <textarea
                    id="image-gen-prompt"
                    value={imageGenPrompt}
                    onChange={(e) => setImageGenPrompt(e.target.value)}
                    rows={6}
                    placeholder="Обёртка вокруг шот-промпта; используйте {SHOT_PROMPT} для подстановки..."
                    className="w-full brutal-input px-4 py-3 text-sm resize-y leading-relaxed min-h-[140px]"
                  />
                </div>

                <div>
                  <label htmlFor="enhance-prompt" className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
                    Промпт постобработки (Enhance)
                  </label>
                  <textarea
                    id="enhance-prompt"
                    value={enhancePrompt}
                    onChange={(e) => setEnhancePrompt(e.target.value)}
                    rows={6}
                    placeholder="Как улучшать изображения и усиливать фотореализм..."
                    className="w-full brutal-input px-4 py-3 text-sm resize-y leading-relaxed min-h-[140px]"
                  />
                </div>
              </div>
            </SettingsSection>
          </div>
        </div>
      </div>
    </div>
  )
}

