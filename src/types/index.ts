export type ShotStatus = 'draft' | 'img_gen' | 'img_review' | 'vid_gen' | 'vid_review' | 'approved'
export type PipelineStage = 'brief' | 'script' | 'shots' | 'review' | 'export' | 'montage_draft' | 'montage_review' | 'rendered'
export type BriefType = 'text' | 'visual' | 'mixed'

export interface ApiErrorResponse {
  error: string
  code?: string
  details?: unknown
}

export interface BriefAsset {
  id: string
  filename: string
  label: string
  url: string // object URL or server path
  thumbnail?: string
}

export interface Brief {
  text: string
  assets: BriefAsset[]
  targetDuration: number // seconds, e.g. 30, 60, 90
}

export interface Shot {
  id: string
  order: number
  status: ShotStatus
  scene: string
  audioDescription: string
  imagePrompt: string
  videoPrompt: string
  duration: number
  assetRefs: string[] // filenames from brief
  generatedImages: string[]
  enhancedImages: string[]
  videoFile: string | null
}

export interface VideoGenerationResult {
  filename: string
  url: string
  external?: boolean
  cached?: boolean
  requestedQuality: string
  appliedQuality?: string
  appliedQualityParam?: string
}

export interface ProjectSettings {
  textModel: string
  imageModel: string
  enhanceModel: string
  masterPromptScriptwriter: string
  masterPromptShotSplitter: string
  masterPromptEnhance: string
}

export interface Project {
  id: string
  name: string
  created: string
  updated: string
  stage: PipelineStage
  briefType: BriefType
  brief: Brief
  script: string
  shots: Shot[]
  settings: ProjectSettings
  directorState?: DirectorState
  // Montage fields
  voiceoverScript?: string
  voiceoverScriptApproved?: boolean
  voiceoverFile?: string
  voiceoverProvider?: string
  voiceoverVoiceId?: string
  musicFile?: string
  musicPrompt?: string
  musicProvider?: string
  montagePlan?: MontagePlan
  renders?: RenderJob[]
}

// ── Montage Types ────────────────────────────────────────────────────

export interface MontageStyle {
  preset: 'premium' | 'calm' | 'dynamic' | 'custom'
  fontFamily: string
  primaryColor: string
  secondaryColor: string
  textColor: string
}

export interface TimelineEntry {
  shotId: string
  clipFile: string
  startSec: number
  durationSec: number
  trimStartSec?: number
  trimEndSec?: number
  motionEffect?: 'ken_burns' | 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right'
}

export interface TransitionEntry {
  fromShotId: string
  toShotId: string
  type: 'cut' | 'fade' | 'crossfade' | 'slide_left' | 'slide_right' | 'zoom_blur' | 'wipe'
  durationSec: number
  easing?: 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out'
}

export interface IntroCard {
  title: string
  subtitle?: string
  durationSec: number
  animation: 'fade_in' | 'slide_up' | 'typewriter'
}

export interface LowerThird {
  shotId: string
  text: string
  position: 'bottom_left' | 'bottom_center' | 'bottom_right'
  appearAtSec: number
  durationSec: number
}

export interface OutroCard {
  title: string
  phone?: string
  website?: string
  logoFile?: string
  durationSec: number
  animation: 'fade_in' | 'slide_up'
}

export interface MontagePlan {
  version: number
  format: {
    width: number
    height: number
    fps: number
  }
  timeline: TimelineEntry[]
  transitions: TransitionEntry[]
  motionGraphics: {
    intro?: IntroCard
    lowerThirds: LowerThird[]
    outro?: OutroCard
  }
  audio: {
    voiceover: { file: string; gainDb: number }
    music: {
      file: string
      gainDb: number
      duckingDb: number
      duckFadeMs: number
    }
  }
  style: MontageStyle
}

export type RenderPhase = 'bundling' | 'compositing' | 'encoding' | 'finalizing'

export interface RenderJob {
  id: string
  createdAt: string
  quality: 'preview' | 'final'
  resolution: string
  status: 'queued' | 'rendering' | 'done' | 'failed'
  progress?: number
  phase?: RenderPhase
  startedAt?: string
  completedAt?: string
  frameCurrent?: number
  frameTotal?: number
  renderFps?: number
  outputFile?: string
  durationSec?: number
  errorMessage?: string
  logFile?: string
}

// ── Creative Director ────────────────────────────────────────────────

export type DirectorVerdict = 'approve' | 'revise' | 'reject'
export type DirectorReviewStage = 'script' | 'shots' | 'images'

export interface DirectorNote {
  id: string
  target: string              // 'script' | shotId | imageFilename
  verdict: DirectorVerdict
  comment: string
  suggestion?: string         // конкретное предложение по исправлению
  type?: 'issue' | 'success'
  resolvedAt?: string
  resolvedByAction?: string
}

export interface DirectorReview {
  id: string
  stage: DirectorReviewStage
  createdAt: string
  model: string
  overallVerdict: DirectorVerdict
  summary: string
  notes: DirectorNote[]
  shotVerdicts?: Record<string, DirectorVerdict>
  resolvedAt?: string
  resolvedByAction?: string
}

export interface DirectorState {
  reviews: DirectorReview[]
  latestByStage: Record<string, string>  // stage → reviewId
}

// ── Settings & Project ──────────────────────────────────────────────

export interface AppSettings {
  openRouterApiKey: string
  defaultTextModel: string
  defaultDescribeModel: string
  defaultScriptModel: string
  defaultShotSplitModel: string
  defaultReviewModel: string
  defaultImageModel: string
  defaultEnhanceModel: string
  falApiKey: string
  replicateApiToken: string
  defaultImageGenModel: string
  defaultImageNoRefGenModel?: string
  defaultVideoGenModel: string
  defaultAudioGenModel: string
  imageSize: string
  imageQuality: string
  videoQuality: string
  enhanceSize: string
  enhanceQuality: string
  imageAspectRatio: string
  defaultDirectorModel: string
  masterPromptDirector: string
  masterPromptScriptwriter: string
  masterPromptShotSplitter: string
  masterPromptEnhance: string
  masterPromptDescribe: string
  masterPromptImageGen: string
  // Montage settings
  defaultVoiceoverProvider?: string
  defaultVoiceoverVoiceId?: string
  elevenLabsApiKey?: string
  sunoApiKey?: string
  defaultMusicStyle?: string
  defaultMontagePreset?: string
  remotionConcurrency?: number
}
