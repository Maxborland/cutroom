export type ShotStatus = 'draft' | 'img_gen' | 'img_review' | 'vid_gen' | 'vid_review' | 'approved'
export type PipelineStage = 'brief' | 'script' | 'shots' | 'review' | 'export'
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
}
