export type ShotStatus = 'draft' | 'img_gen' | 'img_review' | 'vid_gen' | 'vid_review' | 'approved'
export type PipelineStage = 'brief' | 'script' | 'shots' | 'review' | 'export' | 'montage_draft' | 'montage_review' | 'rendered'
export type BriefType = 'text' | 'visual' | 'mixed'

export interface ApiErrorResponse {
  error: string
  code?: string
  details?: unknown
}

export type SystemLicenseStatus = 'unactivated' | 'trial' | 'active' | 'grace' | 'trial_expired'

export interface SystemLicenseState {
  status: SystemLicenseStatus
  trialDaysRemaining: number
  restrictedMode: boolean
  lastCheckAt: string | null
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
  videoDescription?: ShotVideoDescription
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
  narrationAnchors?: NarrationAnchor[]
  anchorMatches?: AnchorMatch[]
  anchorCoverageSummary?: AnchorCoverageSummary
  semanticBlocks?: SemanticBlock[]
  montagePlan?: MontagePlan
  montageReview?: MontageReview
  latestExportArtifact?: ProjectExportArtifact
  renders?: RenderJob[]
}

export interface ProjectExportArtifact {
  filename: string
  exportedAt: string
}

// ── Montage Types ────────────────────────────────────────────────────

export interface NarrationAnchor {
  id: string
  sourceText: string
  label: string
  order: number
  startSec?: number
  endSec?: number
  intent: 'hook' | 'feature' | 'detail' | 'lifestyle' | 'cta'
}

export interface ShotVideoDescriptionMoment {
  id: string
  label: string
  startSec?: number
  endSec?: number
  tags: string[]
  summary: string
}

export interface ShotVideoDescription {
  version: number
  summary: string
  tags: string[]
  matchHints: string[]
  moments: ShotVideoDescriptionMoment[]
}

export interface AnchorMatchCandidate {
  shotId: string
  momentId?: string
  confidence: number
  reason: string
}

export interface AnchorMatch {
  anchorId: string
  selectedShotId?: string
  selectedMomentId?: string
  confidence: number
  status: 'matched' | 'weak_match' | 'unmatched'
  candidates: AnchorMatchCandidate[]
}

export interface AnchorCoverageSummary {
  totalAnchors: number
  matchedAnchors: number
  weakMatches: number
  unmatchedAnchors: number
}

export type GroundedMatchClass = 'direct' | 'visual' | 'atmospheric' | 'fallback' | 'unresolved'

export interface ScriptBlock {
  id: string
  order: number
  sourceText: string
  intent: string
}

export interface GroundingPacket {
  literalQuery: string
  visualQueries: string[]
  moodQueries: string[]
  fallbackMode: 'direct_only' | 'visual_ok' | 'atmospheric_broll'
}

export interface GroundedScriptBlock extends ScriptBlock {
  grounding: GroundingPacket
  summary: string
  matchClass?: GroundedMatchClass
}

export interface SemanticBlockSegment {
  shotId: string
  momentId?: string
  durationSec: number
  weight: number
  reason: string
}

export interface SemanticBlockAlternative {
  shotId: string
  momentId?: string
  confidence: number
  reason: string
  rejectedBecause: string
}

export interface SemanticBlock {
  id: string
  anchorId: string
  anchorText: string
  anchorLabel: string
  strategy: 'solo' | 'pair' | 'split' | 'cascade'
  confidence: number
  segments: SemanticBlockSegment[]
  explanation?: string[]
  alternatives?: SemanticBlockAlternative[]
}

export interface MontageStyle {
  preset: 'premium' | 'calm' | 'dynamic' | 'custom'
  fontFamily: string
  primaryColor: string
  secondaryColor: string
  textColor: string
}

export interface TimelineEntry {
  clipId?: string
  shotId: string
  anchorId?: string
  semanticBlockId?: string
  selectedMomentId?: string
  clipFile: string
  startSec: number
  durationSec: number
  trimStartSec?: number
  trimEndSec?: number
  motionEffect?: 'ken_burns' | 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right'
}

export interface TransitionEntry {
  fromClipId?: string
  toClipId?: string
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
  semanticBlocks?: SemanticBlock[]
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

export interface MontageAssemblySummary {
  blocks: number
  clips: number
  issues: string[]
  steps: MontageAssemblyStep[]
  directBlocks: number
  visualBlocks: number
  atmosphericBlocks: number
  unresolvedBlocks: number
  groundedBlocks?: GroundedScriptBlock[]
}

export type MontageReviewIssueType =
  | 'asset_overuse'
  | 'visual_repetition'
  | 'pacing_drag'
  | 'novelty_gap'
  | 'coverage_gap'

export type MontageReviewSeverity = 'low' | 'medium' | 'high'

export type MontageAutoFixType =
  | 'move_repeat'
  | 'swap_candidate'
  | 'split_clip'
  | 'change_block_strategy'
  | 'insert_bridge'

export type MontageShotRequestPriority = 'nice_to_have' | 'recommended' | 'blocking'

export interface MontageReviewIssue {
  id: string
  type: MontageReviewIssueType
  severity: MontageReviewSeverity
  blockId?: string
  clipIds: string[]
  message: string
  suggestedAction?: string
}

export interface MontageAutoFix {
  id: string
  type: MontageAutoFixType
  applied: boolean
  affectedClipIds: string[]
  explanation: string
}

export interface MontageShotRequest {
  id: string
  blockId: string
  priority: MontageShotRequestPriority
  neededVisualRole: string
  shotGoal: string
  promptHints: string[]
  recommendedCount: number
  canUseImageOnly: boolean
}

export interface MontageReview {
  score: number
  summary: {
    issues: number
    autoFixes: number
    blockingRequests: number
  }
  issues: MontageReviewIssue[]
  autoFixes: MontageAutoFix[]
  suggestedShotRequests: MontageShotRequest[]
}

export interface MontageAssemblyStep {
  key: 'describe-videos' | 'extract-anchors' | 'match-anchors' | 'generate-plan'
  status: 'done' | 'skipped' | 'blocked' | 'failed'
  detail?: string
}

export interface RenderJob {
  id: string
  createdAt: string
  quality: 'preview' | 'final'
  resolution: string
  status: 'queued' | 'rendering' | 'done' | 'failed'
  progress?: number
  outputFile?: string
  errorMessage?: string
}


export interface OpenReelBundleMeta {
  version: string
  exportedAt: number
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
  imageNoRefSize: string
  imageNoRefQuality: string
  imageNoRefAspectRatio: string
  videoQuality: string
  enhanceSize: string
  enhanceQuality: string
  enhanceAspectRatio: string
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
}
