import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { api, getApiErrorMessage } from '../lib/api'
import { useAuthStore } from '../stores/authStore'
import {
  Key,
  Wand2,
  Save,
  Loader2,
  CheckCircle2,
  Sparkles,
  Film,
  Crown,
  RefreshCw,
  AlertTriangle,
  LayoutGrid,
  UserPlus,
} from 'lucide-react'
import { ModelSelect } from './ModelSelect'
import { LicenseStatusCard } from './system/LicenseStatusCard'
import { UserManagementView } from './system/UserManagementView'
import type { SystemLicenseState } from '../types'
import type { AuthUser } from '../lib/api'

const SIZE_OPTIONS = [
  { value: 'auto', label: 'Auto (модель выбирает)' },
  { value: '1024x1024', label: '1024×1024' },
  { value: '1536x1024', label: '1536×1024 (ландшафт)' },
  { value: '1024x1536', label: '1024×1536 (портрет)' },
]

const QUALITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

const ASPECT_RATIO_OPTIONS = [
  { value: '16:9', label: '16:9 (ландшафт)' },
  { value: '9:16', label: '9:16 (портрет)' },
  { value: '1:1', label: '1:1 (квадрат)' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
]

const EMPTY_MODEL_OPTIONS: string[] = []

function normalizeImageAspectRatioValue(rawAspectRatio: string, model?: ImageModelOption): string {
  const modelOptions = model?.imageAspectRatioOptions || []
  const hasExplicitSupport = model?.imageAspectRatioSupport === 'explicit' && modelOptions.length > 0
  const normalizedAspectRatio = rawAspectRatio.trim()

  if (!hasExplicitSupport) {
    return normalizedAspectRatio || '16:9'
  }

  if (!normalizedAspectRatio) return modelOptions[0]

  const exact = modelOptions.find((value) => value.toLowerCase() === normalizedAspectRatio.toLowerCase())
  return exact || modelOptions[0]
}

function getImageModelControlState(model?: ImageModelOption) {
  const modelResolutionOptions = model?.imageResolutionOptions || EMPTY_MODEL_OPTIONS
  const hasModelResolutionOptions =
    model?.imageResolutionSupport === 'explicit' && modelResolutionOptions.length > 0
  const modelAspectRatioOptions = model?.imageAspectRatioOptions || EMPTY_MODEL_OPTIONS
  const hasModelAspectRatioOptions =
    model?.imageAspectRatioSupport === 'explicit' && modelAspectRatioOptions.length > 0

  return {
    modelAspectRatioOptions,
    hasModelResolutionOptions,
    hasModelAspectRatioOptions,
    qualityOptions: hasModelResolutionOptions
      ? modelResolutionOptions.map((value) => ({ value, label: value }))
      : QUALITY_OPTIONS,
    aspectRatioOptions: hasModelAspectRatioOptions
      ? modelAspectRatioOptions.map((value) => ({ value, label: value }))
      : ASPECT_RATIO_OPTIONS,
  }
}

function dedupeImageModelOptions(models: ImageModelOption[]): ImageModelOption[] {
  const seen = new Set<string>()
  const deduped: ImageModelOption[] = []

  for (const model of models) {
    const id = model.id.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    deduped.push(model)
  }

  return deduped
}

const SECTIONS = [
  { id: 'license', label: 'Лицензия', icon: <Crown size={14} /> },
  { id: 'api', label: 'Ключи и LLM', icon: <Key size={14} /> },
  { id: 'generation', label: 'Генерация медиа', icon: <Film size={14} /> },
  { id: 'director', label: 'Креативный директор', icon: <Crown size={14} /> },
  { id: 'access', label: 'Доступ команды', icon: <UserPlus size={14} /> },
  { id: 'prompts', label: 'Мастер-промпты', icon: <Wand2 size={14} /> },
] as const

type VideoModelOption = {
  id: string
  name: string
  videoQualityOptions?: string[]
  videoQualitySupport?: 'explicit' | 'none'
  videoDurationOptions?: string[]
  videoDurationSupport?: 'explicit' | 'none'
}

type ImageModelOption = {
  id: string
  name: string
  imageResolutionOptions?: string[]
  imageResolutionSupport?: 'explicit' | 'none'
  imageAspectRatioOptions?: string[]
  imageAspectRatioSupport?: 'explicit' | 'none'
  requiresImageInput?: boolean
}

function normalizeImageQualityValue(rawQuality: string, model?: ImageModelOption): string {
  const modelOptions = model?.imageResolutionOptions || []
  const hasExplicitSupport = model?.imageResolutionSupport === 'explicit' && modelOptions.length > 0
  const normalizedQuality = rawQuality.trim()

  if (hasExplicitSupport) {
    if (!normalizedQuality) return modelOptions[modelOptions.length - 1]

    const exact = modelOptions.find((value) => value.toLowerCase() === normalizedQuality.toLowerCase())
    if (exact) return exact

    const lowered = normalizedQuality.toLowerCase()
    if (lowered === 'low') return modelOptions[0]
    if (lowered === 'medium') return modelOptions[Math.floor((modelOptions.length - 1) / 2)]
    if (lowered === 'high') return modelOptions[modelOptions.length - 1]

    return modelOptions[modelOptions.length - 1]
  }

  if (!normalizedQuality) return 'high'

  const lowered = normalizedQuality.toLowerCase()
  if (lowered === 'low' || lowered === 'medium' || lowered === 'high') {
    return lowered
  }

  if (/4k|2160/i.test(normalizedQuality)) return 'high'
  if (/2k|1440|1080/i.test(normalizedQuality)) return 'medium'
  if (/1k|768|720|512|480/i.test(normalizedQuality)) return 'low'

  return 'high'
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
    <section id={id} className="brutal-card bg-surface-1 p-5 sm:p-6 relative overflow-visible">
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

function MediaConfigCard({
  title,
  accent,
  note,
  children,
}: {
  title: string
  accent: string
  note?: string
  children: ReactNode
}) {
  return (
    <div className="relative overflow-visible rounded-[8px] border border-border/80 bg-surface-2/90 p-3 sm:p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)_inset]">
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-[2px] ${accent}`} />
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="inline-flex items-center rounded-full border border-border/70 bg-surface-3 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary">
          {title}
        </span>
      </div>
      {note && (
        <p className="mb-3 max-w-[52ch] text-[10px] leading-relaxed text-text-muted">
          {note}
        </p>
      )}
      {children}
    </div>
  )
}

export function SettingsView() {
  const currentUser = useAuthStore((state) => state.user)
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
  const [imageNoRefGenModel, setImageNoRefGenModel] = useState('')
  const [videoGenModel, setVideoGenModel] = useState('fal/kling-2.1-pro')
  const [audioGenModel, setAudioGenModel] = useState('fal/minimax/speech-02-hd')
  const [imageAspectRatio, setImageAspectRatio] = useState('16:9')
  const [imageSize, setImageSize] = useState('auto')
  const [imageQuality, setImageQuality] = useState('high')
  const [imageNoRefAspectRatio, setImageNoRefAspectRatio] = useState('16:9')
  const [imageNoRefSize, setImageNoRefSize] = useState('auto')
  const [imageNoRefQuality, setImageNoRefQuality] = useState('high')
  const [videoQuality, setVideoQuality] = useState('high')
  const [enhanceSize, setEnhanceSize] = useState('auto')
  const [enhanceQuality, setEnhanceQuality] = useState('high')
  const [enhanceAspectRatio, setEnhanceAspectRatio] = useState('16:9')
  const [scriptPrompt, setScriptPrompt] = useState('')
  const [splitterPrompt, setSplitterPrompt] = useState('')
  const [directorModel, setDirectorModel] = useState('openai/gpt-4o')
  const [directorPrompt, setDirectorPrompt] = useState('')
  const [enhancePrompt, setEnhancePrompt] = useState('')
  const [describePrompt, setDescribePrompt] = useState('')
  const [imageGenPrompt, setImageGenPrompt] = useState('')

  const [textModels, setTextModels] = useState<{ id: string; name: string }[]>([])
  const [imageModels, setImageModels] = useState<ImageModelOption[]>([])
  const [imageGenModels, setImageGenModels] = useState<ImageModelOption[]>([])
  const [videoGenModels, setVideoGenModels] = useState<VideoModelOption[]>([])
  const [audioGenModels, setAudioGenModels] = useState<{ id: string; name: string }[]>([])

  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'editor' | 'viewer'>('editor')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteUrl, setInviteUrl] = useState('')
  const [licenseState, setLicenseState] = useState<SystemLicenseState | null>(null)
  const [licenseLoading, setLicenseLoading] = useState(true)
  const [licenseError, setLicenseError] = useState<string | null>(null)
  const [teamUsers, setTeamUsers] = useState<AuthUser[]>([])
  const [teamLoading, setTeamLoading] = useState(true)
  const [teamError, setTeamError] = useState<string | null>(null)
  const inviteRoleOptions = currentUser?.role === 'admin'
    ? [
        { value: 'editor' as const, label: 'Редактор' },
        { value: 'viewer' as const, label: 'Наблюдатель' },
      ]
    : [
        { value: 'admin' as const, label: 'Администратор' },
        { value: 'editor' as const, label: 'Редактор' },
        { value: 'viewer' as const, label: 'Наблюдатель' },
      ]

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
    } catch (error: unknown) {
      setModelsError(getApiErrorMessage(error, 'Не удалось загрузить список моделей'))
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
        if (typeof settings.defaultImageNoRefGenModel === 'string') setImageNoRefGenModel(settings.defaultImageNoRefGenModel)
        if (settings.defaultVideoGenModel) setVideoGenModel(settings.defaultVideoGenModel)
        if (settings.defaultAudioGenModel) setAudioGenModel(settings.defaultAudioGenModel)
        if (settings.imageAspectRatio) setImageAspectRatio(settings.imageAspectRatio)
        if (settings.imageSize) setImageSize(settings.imageSize)
        if (settings.imageQuality) setImageQuality(settings.imageQuality)
        if (settings.imageNoRefAspectRatio) setImageNoRefAspectRatio(settings.imageNoRefAspectRatio)
        if (settings.imageNoRefSize) setImageNoRefSize(settings.imageNoRefSize)
        if (settings.imageNoRefQuality) setImageNoRefQuality(settings.imageNoRefQuality)
        if (settings.videoQuality) setVideoQuality(settings.videoQuality)
        if (settings.enhanceSize) setEnhanceSize(settings.enhanceSize)
        if (settings.enhanceQuality) setEnhanceQuality(settings.enhanceQuality)
        if (settings.enhanceAspectRatio) setEnhanceAspectRatio(settings.enhanceAspectRatio)
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
    setLicenseLoading(true)
    setLicenseError(null)
    api.system
      .getLicense()
      .then((license) => setLicenseState(license))
      .catch((loadError) => setLicenseError(getApiErrorMessage(loadError, 'Не удалось загрузить статус лицензии')))
      .finally(() => setLicenseLoading(false))

    setTeamLoading(true)
    setTeamError(null)
    api.users
      .list()
      .then((response) => setTeamUsers(response.users))
      .catch((loadError) => setTeamError(getApiErrorMessage(loadError, 'Не удалось загрузить список участников')))
      .finally(() => setTeamLoading(false))
  }, [])

  useEffect(() => {
    const selected = videoGenModels.find((model) => model.id === videoGenModel)
    const normalized = normalizeVideoQualityValue(videoQuality, selected)
    if (normalized !== videoQuality) setVideoQuality(normalized)
  }, [videoGenModel, videoGenModels, videoQuality])

  useEffect(() => {
    const selected = imageGenModels.find((model) => model.id === imageGenModel)
    const normalized = normalizeImageQualityValue(imageQuality, selected)
    if (normalized !== imageQuality) setImageQuality(normalized)
  }, [imageGenModel, imageGenModels, imageQuality])

  const selectedImageGenModel = imageGenModels.find((model) => model.id === imageGenModel)
  const {
    modelAspectRatioOptions: modelImageAspectRatioOptions,
    hasModelResolutionOptions: hasModelImageResolutionOptions,
    hasModelAspectRatioOptions: hasModelImageAspectRatioOptions,
    qualityOptions: imageQualityOptions,
    aspectRatioOptions: imageAspectRatioOptions,
  } = getImageModelControlState(selectedImageGenModel)
  const noRefImageModelOptions: ImageModelOption[] = [
    { id: '', name: 'OpenRouter (по умолчанию)' },
    ...imageGenModels.filter((model) => !model.requiresImageInput),
  ]
  if (!noRefImageModelOptions.some((model) => model.id === 'fal-endpoint:fal-ai/nano-banana-pro')) {
    noRefImageModelOptions.push({
      id: 'fal-endpoint:fal-ai/nano-banana-pro',
      name: 'Nano Banana Pro (Text-to-Image)',
    })
  }
  if (imageNoRefGenModel && !noRefImageModelOptions.some((model) => model.id === imageNoRefGenModel)) {
    const fallbackModel = imageGenModels.find((model) => model.id === imageNoRefGenModel)
    noRefImageModelOptions.push(fallbackModel || { id: imageNoRefGenModel, name: imageNoRefGenModel })
  }
  const selectedNoRefImageModel = noRefImageModelOptions.find((model) => model.id === imageNoRefGenModel)
  const {
    modelAspectRatioOptions: modelNoRefImageAspectRatioOptions,
    hasModelResolutionOptions: hasNoRefImageResolutionOptions,
    hasModelAspectRatioOptions: hasNoRefImageAspectRatioOptions,
    qualityOptions: noRefImageQualityOptions,
    aspectRatioOptions: noRefImageAspectRatioOptions,
  } = getImageModelControlState(selectedNoRefImageModel)
  const enhanceModelOptions = dedupeImageModelOptions([
    ...imageModels,
    ...imageGenModels,
  ])
  if (enhanceModel && !enhanceModelOptions.some((model) => model.id === enhanceModel)) {
    enhanceModelOptions.push({ id: enhanceModel, name: enhanceModel })
  }
  const selectedEnhanceModel = enhanceModelOptions.find((model) => model.id === enhanceModel)
  const {
    modelAspectRatioOptions: modelEnhanceAspectRatioOptions,
    hasModelResolutionOptions: hasEnhanceResolutionOptions,
    hasModelAspectRatioOptions: hasEnhanceAspectRatioOptions,
    qualityOptions: enhanceQualityOptions,
    aspectRatioOptions: enhanceAspectRatioOptions,
  } = getImageModelControlState(selectedEnhanceModel)

  useEffect(() => {
    if (!hasModelImageAspectRatioOptions) return

    const normalized = normalizeImageAspectRatioValue(imageAspectRatio, selectedImageGenModel)
    if (normalized !== imageAspectRatio) setImageAspectRatio(normalized)
  }, [hasModelImageAspectRatioOptions, imageAspectRatio, modelImageAspectRatioOptions])

  useEffect(() => {
    const normalized = normalizeImageQualityValue(imageNoRefQuality, selectedNoRefImageModel)
    if (normalized !== imageNoRefQuality) setImageNoRefQuality(normalized)
  }, [imageNoRefGenModel, imageNoRefQuality, selectedNoRefImageModel])

  useEffect(() => {
    if (!hasNoRefImageAspectRatioOptions) return

    const normalized = normalizeImageAspectRatioValue(imageNoRefAspectRatio, selectedNoRefImageModel)
    if (normalized !== imageNoRefAspectRatio) setImageNoRefAspectRatio(normalized)
  }, [hasNoRefImageAspectRatioOptions, imageNoRefAspectRatio, modelNoRefImageAspectRatioOptions, selectedNoRefImageModel])

  useEffect(() => {
    const normalized = normalizeImageQualityValue(enhanceQuality, selectedEnhanceModel)
    if (normalized !== enhanceQuality) setEnhanceQuality(normalized)
  }, [enhanceModel, enhanceQuality, selectedEnhanceModel])

  useEffect(() => {
    if (!hasEnhanceAspectRatioOptions) return

    const normalized = normalizeImageAspectRatioValue(enhanceAspectRatio, selectedEnhanceModel)
    if (normalized !== enhanceAspectRatio) setEnhanceAspectRatio(normalized)
  }, [enhanceAspectRatio, hasEnhanceAspectRatioOptions, modelEnhanceAspectRatioOptions, selectedEnhanceModel])

  const selectedVideoModel = videoGenModels.find((model) => model.id === videoGenModel)
  const modelVideoQualityOptions = selectedVideoModel?.videoQualityOptions || EMPTY_MODEL_OPTIONS
  const hasModelVideoQualityOptions =
    selectedVideoModel?.videoQualitySupport === 'explicit' && modelVideoQualityOptions.length > 0

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)

    try {
      const normalizedImageQuality = normalizeImageQualityValue(imageQuality, selectedImageGenModel)
      const normalizedImageNoRefQuality = normalizeImageQualityValue(imageNoRefQuality, selectedNoRefImageModel)
      const normalizedEnhanceQuality = normalizeImageQualityValue(enhanceQuality, selectedEnhanceModel)
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
        defaultImageNoRefGenModel: imageNoRefGenModel,
        defaultVideoGenModel: videoGenModel,
        defaultAudioGenModel: audioGenModel,
        imageAspectRatio,
        imageSize,
        imageQuality: normalizedImageQuality,
        imageNoRefAspectRatio,
        imageNoRefSize,
        imageNoRefQuality: normalizedImageNoRefQuality,
        videoQuality: normalizedVideoQuality,
        enhanceSize,
        enhanceQuality: normalizedEnhanceQuality,
        enhanceAspectRatio,
        defaultDirectorModel: directorModel,
        masterPromptDirector: directorPrompt,
        masterPromptScriptwriter: scriptPrompt,
        masterPromptShotSplitter: splitterPrompt,
        masterPromptEnhance: enhancePrompt,
        masterPromptDescribe: describePrompt,
        masterPromptImageGen: imageGenPrompt,
      })
      if (normalizedImageQuality !== imageQuality) setImageQuality(normalizedImageQuality)
      if (normalizedImageNoRefQuality !== imageNoRefQuality) setImageNoRefQuality(normalizedImageNoRefQuality)
      if (normalizedEnhanceQuality !== enhanceQuality) setEnhanceQuality(normalizedEnhanceQuality)
      if (normalizedVideoQuality !== videoQuality) setVideoQuality(normalizedVideoQuality)
      await loadModels()
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (error: unknown) {
      setError(getApiErrorMessage(error, 'Не удалось сохранить настройки'))
    } finally {
      setSaving(false)
    }
  }

  const handleCreateInvite = async () => {
    const normalizedEmail = inviteEmail.trim().toLowerCase()
    if (!normalizedEmail) return

    setInviteLoading(true)
    setInviteError(null)
    setInviteUrl('')

    try {
      const response = await api.users.invite(normalizedEmail, inviteRole)
      const nextInviteUrl = new URL(response.invite.inviteUrl, window.location.origin).toString()
      setInviteUrl(nextInviteUrl)
    } catch (error: unknown) {
      setInviteError(getApiErrorMessage(error, 'Не удалось создать приглашение'))
    } finally {
      setInviteLoading(false)
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
              id="license"
              icon={<Crown size={14} />}
              title="Лицензия"
              subtitle="Статус trial/activation и диагностическая информация по коммерческому инстансу."
            >
              <LicenseStatusCard license={licenseState} loading={licenseLoading} error={licenseError} />
            </SettingsSection>

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

              <div className="grid gap-4 lg:grid-cols-2">
                <MediaConfigCard
                  title="Изображения"
                  accent="bg-gradient-to-r from-amber via-orange-500/70 to-transparent"
                  note={selectedImageGenModel?.requiresImageInput ? 'Для этой модели обязателен референс из брифа или исходного кадра.' : undefined}
                >
                  <ModelSelect
                    label="Модель генерации изображений"
                    value={imageGenModel}
                    onChange={setImageGenModel}
                    models={imageGenModels}
                    loading={modelsLoading}
                    placeholder="fal/flux-kontext-max"
                  />
                  <div className="mt-4 border-t border-border/70 pt-3">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <label htmlFor="image-size" className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
                          Размер генерации
                        </label>
                        <select
                          id="image-size"
                          value={imageSize}
                          onChange={(e) => setImageSize(e.target.value)}
                          className="w-full brutal-input px-3 py-2 text-sm"
                          disabled={hasModelImageResolutionOptions}
                        >
                          {SIZE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="image-quality" className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
                          {hasModelImageResolutionOptions ? 'Разрешение генерации' : 'Качество генерации'}
                        </label>
                        <select
                          id="image-quality"
                          value={imageQuality}
                          onChange={(e) => setImageQuality(e.target.value)}
                          className="w-full brutal-input px-3 py-2 text-sm"
                        >
                          {imageQualityOptions.map((o) => (
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
                          {imageAspectRatioOptions.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </MediaConfigCard>

                <MediaConfigCard
                  title="Без референса"
                  accent="bg-gradient-to-r from-cyan-400/70 via-sky-400/40 to-transparent"
                  note="Используется, когда выбранная image-модель требует референс, но у шота нет прикрепленных изображений."
                >
                  <ModelSelect
                    label={'\u041c\u043e\u0434\u0435\u043b\u044c \u0431\u0435\u0437 \u0440\u0435\u0444\u0435\u0440\u0435\u043d\u0441\u0430'}
                    value={imageNoRefGenModel}
                    onChange={setImageNoRefGenModel}
                    models={noRefImageModelOptions}
                    loading={modelsLoading}
                    placeholder={'OpenRouter (\u043f\u043e \u0443\u043c\u043e\u043b\u0447\u0430\u043d\u0438\u044e)'}
                  />
                  <div className="mt-4 border-t border-border/70 pt-3">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <label htmlFor="image-no-ref-size" className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
                          Размер без референса
                        </label>
                        <select
                          id="image-no-ref-size"
                          value={imageNoRefSize}
                          onChange={(e) => setImageNoRefSize(e.target.value)}
                          className="w-full brutal-input px-3 py-2 text-sm"
                          disabled={hasNoRefImageResolutionOptions}
                        >
                          {SIZE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="image-no-ref-quality" className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
                          {hasNoRefImageResolutionOptions ? 'Разрешение без референса' : 'Качество без референса'}
                        </label>
                        <select
                          id="image-no-ref-quality"
                          value={imageNoRefQuality}
                          onChange={(e) => setImageNoRefQuality(e.target.value)}
                          className="w-full brutal-input px-3 py-2 text-sm"
                        >
                          {noRefImageQualityOptions.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="image-no-ref-aspect-ratio" className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
                          Соотношение сторон без референса
                        </label>
                        <select
                          id="image-no-ref-aspect-ratio"
                          value={imageNoRefAspectRatio}
                          onChange={(e) => setImageNoRefAspectRatio(e.target.value)}
                          className="w-full brutal-input px-3 py-2 text-sm"
                        >
                          {noRefImageAspectRatioOptions.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </MediaConfigCard>

                <MediaConfigCard
                  title="Видео"
                  accent="bg-gradient-to-r from-emerald-400/70 via-lime-400/40 to-transparent"
                >
                  <ModelSelect
                    label="Модель генерации видео"
                    value={videoGenModel}
                    onChange={setVideoGenModel}
                    models={videoGenModels}
                    loading={modelsLoading}
                    placeholder="fal/kling-2.1-pro"
                  />
                  <div className="mt-4 border-t border-border/70 pt-3">
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
                  </div>
                </MediaConfigCard>

                <MediaConfigCard
                  title="Enhance"
                  accent="bg-gradient-to-r from-fuchsia-400/60 via-rose-400/35 to-transparent"
                >
                  <ModelSelect
                    label="Модель Enhance"
                    value={enhanceModel}
                    onChange={setEnhanceModel}
                    models={enhanceModelOptions}
                    loading={modelsLoading}
                    placeholder="openai/gpt-image-1"
                  />
                  <div className="mt-4 border-t border-border/70 pt-3">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <label htmlFor="enhance-size" className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
                          Размер Enhance
                        </label>
                        <select
                          id="enhance-size"
                          value={enhanceSize}
                          onChange={(e) => setEnhanceSize(e.target.value)}
                          className="w-full brutal-input px-3 py-2 text-sm"
                          disabled={hasEnhanceResolutionOptions}
                        >
                          {SIZE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="enhance-quality" className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
                          {hasEnhanceResolutionOptions ? 'Разрешение Enhance' : 'Качество Enhance'}
                        </label>
                        <select
                          id="enhance-quality"
                          value={enhanceQuality}
                          onChange={(e) => setEnhanceQuality(e.target.value)}
                          className="w-full brutal-input px-3 py-2 text-sm"
                        >
                          {enhanceQualityOptions.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="enhance-aspect-ratio" className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
                          Соотношение сторон Enhance
                        </label>
                        <select
                          id="enhance-aspect-ratio"
                          value={enhanceAspectRatio}
                          onChange={(e) => setEnhanceAspectRatio(e.target.value)}
                          className="w-full brutal-input px-3 py-2 text-sm"
                        >
                          {enhanceAspectRatioOptions.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </MediaConfigCard>

                <div className="lg:col-span-2">
                  <MediaConfigCard
                    title="Аудио"
                    accent="bg-gradient-to-r from-violet-400/55 via-indigo-400/30 to-transparent"
                  >
                    <ModelSelect
                      label="Модель генерации аудио"
                      value={audioGenModel}
                      onChange={setAudioGenModel}
                      models={audioGenModels}
                      loading={modelsLoading}
                      placeholder="fal/minimax/speech-02-hd"
                    />
                  </MediaConfigCard>
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
              id="access"
              icon={<UserPlus size={14} />}
              title="Команда"
              subtitle="Активные пользователи инстанса и создание новых приглашений."
            >
              <UserManagementView users={teamUsers} loading={teamLoading} error={teamError} />

              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px_auto] sm:items-end">
                <div>
                  <label htmlFor="team-invite-email" className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1">
                    Email участника
                  </label>
                  <input
                    id="team-invite-email"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => {
                      setInviteEmail(e.target.value)
                      setInviteError(null)
                    }}
                    placeholder="editor@example.com"
                    className="w-full brutal-input px-4 py-2.5 text-sm"
                    autoComplete="email"
                  />
                </div>
                <div>
                  <label htmlFor="team-invite-role" className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1">
                    Роль
                  </label>
                  <select
                    id="team-invite-role"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as 'admin' | 'editor' | 'viewer')}
                    className="w-full brutal-input px-4 py-2.5 text-sm"
                  >
                    {inviteRoleOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => void handleCreateInvite()}
                  disabled={inviteLoading || !inviteEmail.trim()}
                  className="flex items-center justify-center gap-2 rounded-[5px] bg-amber px-4 py-2.5 text-xs font-bold uppercase text-black brutal-btn disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {inviteLoading ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                  Создать приглашение
                </button>
              </div>

              {inviteError && (
                <div className="mt-4 rounded-[5px] border-2 border-border bg-rose-dim px-4 py-3 text-sm text-rose">
                  {inviteError}
                </div>
              )}

              {inviteUrl && (
                <div className="mt-4">
                  <label htmlFor="team-invite-url" className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1">
                    Ссылка-приглашение
                  </label>
                  <input
                    id="team-invite-url"
                    type="text"
                    readOnly
                    value={inviteUrl}
                    className="w-full brutal-input px-4 py-2.5 text-sm"
                  />
                </div>
              )}
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
