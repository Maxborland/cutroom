export type ShotStatus = 'draft' | 'generating' | 'review' | 'approved'
export type PipelineStage = 'brief' | 'script' | 'shots' | 'review' | 'export'
export type BriefType = 'text' | 'visual' | 'mixed'

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
}

export interface AppSettings {
  openRouterApiKey: string
  defaultTextModel: string
  defaultImageModel: string
  higgsfieldKeyId: string
  higgsfieldKeySecret: string
  defaultHiggsfieldImageModel: string
  defaultHiggsfieldVideoModel: string
  imageAspectRatio: string
}
