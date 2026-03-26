import type {
  ApiErrorResponse,
  Project,
  Shot,
  BriefAsset,
  AppSettings,
  DirectorReview,
  DirectorState,
  SystemLicenseState,
  VideoGenerationResult,
  MontagePlan,
  RenderJob,
  AnchorCoverageSummary,
  AnchorMatch,
  NarrationAnchor,
  ShotVideoDescription,
} from '../types/index'
import type { OpenReelBundle } from './openreel-bridge'

const BASE = '/api'

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[]
    ? DeepPartial<U>[]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K]
}

export interface AuthUser {
  id: string
  email: string
  name: string
  role: 'owner' | 'admin' | 'editor' | 'viewer'
  createdAt: string
}

export interface AuthSessionResponse {
  user: AuthUser
}

export interface UsersListResponse {
  users: AuthUser[]
}

export interface InviteResponse {
  invite: {
    token: string
    email: string
    role: 'owner' | 'admin' | 'editor' | 'viewer'
    createdAt: string
    inviteUrl: string
  }
}

export interface RenderStartResponse {
  jobId: string
  status: 'queued'
  quality: RenderJob['quality']
}

export interface DescribeVideosResponse {
  described: number
  skipped: number
  shots: Array<{
    shotId: string
    videoDescription: ShotVideoDescription
  }>
  skippedShots: Array<{
    shotId: string
    reason: string
  }>
}

export interface ExtractAnchorsResponse {
  anchors: NarrationAnchor[]
}

export interface MatchAnchorsResponse {
  anchorMatches: AnchorMatch[]
  anchorCoverageSummary: AnchorCoverageSummary
}

export interface OpenReelExportArtifact {
  filename: string
  exportedAt: number
}

export interface OpenReelSaveProjectPayload {
  version: string
  project: unknown
  exportArtifact?: {
    filename: string
  }
}

export interface OpenReelSaveProjectResponse {
  saved: boolean
  modifiedAt: number
  exportArtifact?: OpenReelExportArtifact
}

export class ApiRequestError extends Error {
  readonly status: number
  readonly code?: string
  readonly details?: unknown
  readonly path?: string

  constructor(message: string, options: { status: number; code?: string; details?: unknown; path?: string }) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = options.status
    this.code = options.code
    this.details = options.details
    this.path = options.path
  }
}

export function isApiRequestError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError
}

const API_ERROR_MESSAGES: Record<string, string> = {
  ACCEPT_INVITE_FAILED: 'Не удалось принять приглашение',
  AUTH_REQUIRED: 'Требуется вход в систему',
  AUTH_FORBIDDEN: 'Недостаточно прав для этого действия.',
  BOOTSTRAP_INVITE_CLOSED: 'Первичная настройка уже завершена.',
  BOOTSTRAP_TOKEN_INVALID: 'Неверный код первичной настройки.',
  INVALID_CREDENTIALS: 'Неверный email или пароль.',
  INVITE_ALREADY_ACCEPTED: 'Приглашение уже использовано.',
  INVITE_EMAIL_REQUIRED: 'Укажите email.',
  INVITE_NOT_FOUND: 'Приглашение не найдено или уже недействительно.',
  LOGIN_FIELDS_REQUIRED: 'Укажите email и пароль.',
  INVITE_ROLE_INVALID: 'Выбрана недопустимая роль приглашения.',
  NAME_REQUIRED: 'Укажите имя.',
  PASSWORD_INVALID: 'Пароль не соответствует требованиям.',
  USER_ALREADY_EXISTS: 'Пользователь с таким email уже существует.',
}

export function getApiErrorMessage(error: unknown, fallback = 'Произошла ошибка'): string {
  if (isApiRequestError(error)) {
    if (error.code && API_ERROR_MESSAGES[error.code]) {
      return API_ERROR_MESSAGES[error.code]
    }

    if (error.message.trim()) {
      return error.message
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  if (typeof error === 'string' && error.trim()) {
    return error
  }

  return fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function readApiError(res: Response): Promise<ApiErrorResponse> {
  const jsonBody = await res.clone().json().catch(() => null)
  if (isRecord(jsonBody) && typeof jsonBody.error === 'string') {
    return {
      error: jsonBody.error,
      code: typeof jsonBody.code === 'string' ? jsonBody.code : undefined,
      details: jsonBody.details,
    }
  }

  const text = (await res.text().catch(() => '')).trim()
  if (text) return { error: text }

  return { error: res.statusText || 'Request failed' }
}

async function throwRequestError(res: Response, path: string): Promise<never> {
  const payload = await readApiError(res)
  throw new ApiRequestError(payload.error || res.statusText || 'Request failed', {
    status: res.status,
    code: payload.code,
    details: payload.details,
    path,
  })
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  if (!res.ok) {
    await throwRequestError(res, path)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  projects: {
    list: () => request<Project[]>('/projects'),
    get: (id: string) => request<Project>(`/projects/${id}`),
    create: (name: string) =>
      request<Project>('/projects', { method: 'POST', body: JSON.stringify({ name }) }),
    update: (id: string, data: DeepPartial<Project>) =>
      request<Project>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),
  },
  auth: {
    login: (email: string, password: string) =>
      request<AuthSessionResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    logout: () => request<void>('/auth/logout', { method: 'POST' }),
    me: () => request<AuthSessionResponse>('/auth/me'),
    acceptInvite: (token: string, name: string, password: string) =>
      request<AuthSessionResponse>('/auth/accept-invite', {
        method: 'POST',
        body: JSON.stringify({ token, name, password }),
      }),
  },
  users: {
    list: () => request<UsersListResponse>('/users'),
    bootstrapInvite: (
      email: string,
      bootstrapToken?: string,
    ) =>
      request<InviteResponse>('/users/bootstrap-owner-invite', {
        method: 'POST',
        body: JSON.stringify({
          email,
          ...(bootstrapToken?.trim() ? { bootstrapToken: bootstrapToken.trim() } : {}),
        }),
      }),
    invite: (
      email: string,
      role?: 'owner' | 'admin' | 'editor' | 'viewer',
    ) =>
      request<InviteResponse>('/users/invite', {
        method: 'POST',
        body: JSON.stringify({
          email,
          ...(role ? { role } : {}),
        }),
      }),
  },
  assets: {
    upload: async (projectId: string, files: File[]) => {
      const form = new FormData()
      files.forEach((f) => form.append('files', f))
      const path = `/projects/${projectId}/assets`
      const res = await fetch(`${BASE}/projects/${projectId}/assets`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      })
      if (!res.ok) await throwRequestError(res, path)
      return res.json()
    },
    delete: (projectId: string, assetId: string) =>
      request<void>(`/projects/${projectId}/assets/${assetId}`, { method: 'DELETE' }),
    url: (projectId: string, filename: string) =>
      `${BASE}/projects/${projectId}/assets/file/${encodeURIComponent(filename)}`,
    updateLabel: (projectId: string, assetId: string, label: string) =>
      request<BriefAsset>(`/projects/${projectId}/assets/${assetId}/label`, {
        method: 'PUT', body: JSON.stringify({ label }),
      }),
    describe: (projectId: string, assetId: string) =>
      request<{ id: string; label: string }>(`/projects/${projectId}/assets/${assetId}/describe`, { method: 'POST' }),
    describeAll: (projectId: string) =>
      request<{ described: number; total: number }>(`/projects/${projectId}/assets/describe-all`, { method: 'POST' }),
  },
  generate: {
    script: (projectId: string) =>
      request<{ script: string }>(`/projects/${projectId}/generate-script`, { method: 'POST' }),
    splitShots: (projectId: string) =>
      request<{ shots: Shot[] }>(`/projects/${projectId}/split-shots`, { method: 'POST' }),
    image: (projectId: string, shotId: string) =>
      request<{ filename: string; url: string }>(`/projects/${projectId}/shots/${shotId}/generate-image`, { method: 'POST' }),
    cancelImage: (projectId: string, shotId: string) =>
      request<{ cancelled: boolean }>(`/projects/${projectId}/shots/${shotId}/cancel-generation`, { method: 'POST' }),
    cancelAll: (projectId: string) =>
      request<{ cancelled: number }>(`/projects/${projectId}/cancel-all-generation`, { method: 'POST' }),
    enhance: (projectId: string, shotId: string, sourceImage: string) =>
      request<{ filename: string; url: string }>(`/projects/${projectId}/shots/${shotId}/enhance-image`, {
        method: 'POST',
        body: JSON.stringify({ sourceImage }),
      }),
    enhanceAll: (projectId: string) =>
      request<{ enhanced: number; total: number }>(`/projects/${projectId}/enhance-all`, { method: 'POST' }),
    video: (projectId: string, shotId: string) =>
      request<VideoGenerationResult>(`/projects/${projectId}/shots/${shotId}/generate-video`, { method: 'POST' }),
    allVideos: (projectId: string) =>
      request<{ generated: number; total: number }>(`/projects/${projectId}/generate-all-videos`, { method: 'POST' }),
    aiReview: (projectId: string, shotId: string) =>
      request<{ review: string }>(`/projects/${projectId}/shots/${shotId}/ai-review`, { method: 'POST' }),
  },
  shots: {
    update: (projectId: string, shotId: string, data: Partial<Shot>) =>
      request<Shot>(`/projects/${projectId}/shots/${shotId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    setStatus: (projectId: string, shotId: string, status: string) =>
      request<Shot>(`/projects/${projectId}/shots/${shotId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      }),
    batchSetStatus: (projectId: string, shotIds: string[], status: string) =>
      request<{ updated: number }>(`/projects/${projectId}/shots/batch-status`, {
        method: 'PUT',
        body: JSON.stringify({ shotIds, status }),
      }),
    uploadVideo: async (projectId: string, shotId: string, file: File) => {
      const form = new FormData()
      form.append('video', file)
      const path = `/projects/${projectId}/shots/${shotId}/video`
      const res = await fetch(`${BASE}/projects/${projectId}/shots/${shotId}/video`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      })
      if (!res.ok) await throwRequestError(res, path)
      return res.json()
    },
    generatedImageUrl: (projectId: string, shotId: string, filename: string) =>
      (filename.startsWith('http://') || filename.startsWith('https://') || filename.startsWith('data:'))
        ? filename
        : `${BASE}/projects/${projectId}/shots/${shotId}/generated/${encodeURIComponent(filename)}`,
    videoUrl: (projectId: string, shotId: string, filename: string) =>
      (filename.startsWith('http://') || filename.startsWith('https://') || filename.startsWith('data:'))
        ? filename
        : `${BASE}/projects/${projectId}/shots/${shotId}/video/${encodeURIComponent(filename)}`,
    cacheVideo: (projectId: string, shotId: string) =>
      request<{ filename: string; url: string }>(`/projects/${projectId}/shots/${shotId}/cache-video`, { method: 'POST' }),
    deleteImage: (projectId: string, shotId: string, filename: string) =>
      request<Shot>(`/projects/${projectId}/shots/${shotId}/image/${encodeURIComponent(filename)}`, { method: 'DELETE' }),
    deleteVideo: (projectId: string, shotId: string) =>
      request<Shot>(`/projects/${projectId}/shots/${shotId}/video`, { method: 'DELETE' }),
  },
  settings: {
    get: () => request<AppSettings>('/settings'),
    update: (data: Partial<AppSettings>) => request<AppSettings>('/settings', { method: 'PUT', body: JSON.stringify(data) }),
  },
  system: {
    getLicense: () => request<SystemLicenseState>('/system/license'),
  },
  models: {
    list: () => request<{
      textModels: { id: string; name: string }[];
      imageModels: { id: string; name: string }[];
      imageGenModels: {
        id: string;
        name: string;
        imageResolutionOptions?: string[];
        imageResolutionSupport?: 'explicit' | 'none';
        imageAspectRatioOptions?: string[];
        imageAspectRatioSupport?: 'explicit' | 'none';
        requiresImageInput?: boolean;
      }[];
      videoGenModels: {
        id: string;
        name: string;
        videoQualityOptions?: string[];
        videoQualitySupport?: 'explicit' | 'none';
      }[];
      audioGenModels: { id: string; name: string }[];
    }>('/models'),
  },
  director: {
    getState: (projectId: string) =>
      request<DirectorState>(`/projects/${projectId}/director`),
    reviewScript: (projectId: string) =>
      request<DirectorReview>(`/projects/${projectId}/director/review-script`, { method: 'POST' }),
    reviewShots: (projectId: string) =>
      request<DirectorReview>(`/projects/${projectId}/director/review-shots`, { method: 'POST' }),
    reviewImages: (projectId: string) =>
      request<DirectorReview>(`/projects/${projectId}/director/review-images`, { method: 'POST' }),
    reviewAll: (projectId: string) =>
      request<{ reviews: DirectorReview[] }>(`/projects/${projectId}/director/review-all`, { method: 'POST' }),
    applyFeedback: (
      projectId: string,
      reviewId: string,
      action: string,
      shotId?: string,
      shotIds?: string[],
    ) =>
      request<unknown>(`/projects/${projectId}/director/apply-feedback`, {
        method: 'POST',
        body: JSON.stringify({ reviewId, action, shotId, shotIds }),
      }),
  },
  export: {
    zipUrl: (projectId: string) => `${BASE}/projects/${projectId}/export`,
    promptsUrl: (projectId: string) => `${BASE}/projects/${projectId}/export/prompts`,
  },
  openreel: {
    getProject: (projectId: string) =>
      request<OpenReelBundle>(`/projects/${projectId}/openreel-project`),
    saveProject: (projectId: string, data: OpenReelSaveProjectPayload) =>
      request<OpenReelSaveProjectResponse>(`/projects/${projectId}/openreel-project`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
  },
  montage: {
    generateVoScript: (projectId: string) =>
      request<{ voiceoverScript: string }>(`/projects/${projectId}/montage/generate-vo-script`, { method: 'POST' }),
    updateVoScript: (projectId: string, script: string) =>
      request<Project>(`/projects/${projectId}/montage/vo-script`, {
        method: 'PUT',
        body: JSON.stringify({ voiceoverScript: script }),
      }),
    approveVoScript: (projectId: string) =>
      request<Project>(`/projects/${projectId}/montage/approve-vo-script`, { method: 'POST' }),
    getVoices: (projectId: string) =>
      request<{
        providers: { id: string; name: string; configured: boolean }[];
        voices: { id: string; name: string; gender: string; language: string; provider: string }[];
      }>(`/projects/${projectId}/montage/voices`),
    normalizeVoText: (projectId: string, text?: string) =>
      request<{ normalizedText: string }>(`/projects/${projectId}/montage/normalize-vo-text`, {
        method: 'POST',
        body: JSON.stringify(text !== undefined ? { text } : {}),
      }),
    deleteVoiceover: (projectId: string) =>
      request<{ deleted: boolean }>(`/projects/${projectId}/montage/voiceover`, { method: 'DELETE' }),
    uploadVoiceover: async (projectId: string, file: File) => {
      const form = new FormData()
      form.append('voiceover', file)
      const path = `/projects/${projectId}/montage/upload-voiceover`
      const res = await fetch(`${BASE}${path}`, { method: 'POST', body: form })
      if (!res.ok) await throwRequestError(res, path)
      return res.json() as Promise<{ voiceoverFile: string; provider: string }>
    },
    generateVoiceover: (projectId: string, options?: { provider?: string; voiceId?: string }) =>
      request<{ voiceoverFile: string; provider: string; voiceId: string }>(`/projects/${projectId}/montage/generate-voiceover`, {
        method: 'POST',
        body: JSON.stringify(options ?? {}),
      }),
    generateMusicPrompt: (projectId: string) =>
      request<{ musicPrompt: string }>(`/projects/${projectId}/montage/generate-music-prompt`, { method: 'POST' }),
    updateMusicPrompt: (projectId: string, musicPrompt: string) =>
      request<Project>(`/projects/${projectId}/montage/music-prompt`, {
        method: 'PUT',
        body: JSON.stringify({ musicPrompt }),
      }),
    deleteMusic: (projectId: string) =>
      request<{ deleted: boolean }>(`/projects/${projectId}/montage/music`, { method: 'DELETE' }),
    uploadMusic: async (projectId: string, file: File) => {
      const form = new FormData()
      form.append('music', file)
      const path = `/projects/${projectId}/montage/upload-music`
      const res = await fetch(`${BASE}${path}`, { method: 'POST', credentials: 'include', body: form })
      if (!res.ok) await throwRequestError(res, path)
      return res.json() as Promise<{ musicFile: string; provider: string }>
    },
    musicUrl: (projectId: string) => `${BASE}/projects/${projectId}/montage/music`,
    voiceoverUrl: (projectId: string) => `${BASE}/projects/${projectId}/montage/voiceover`,
    describeVideos: (projectId: string) =>
      request<DescribeVideosResponse>(`/projects/${projectId}/montage/describe-videos`, { method: 'POST' }),
    extractAnchors: (projectId: string) =>
      request<ExtractAnchorsResponse>(`/projects/${projectId}/montage/extract-anchors`, { method: 'POST' }),
    matchAnchors: (projectId: string) =>
      request<MatchAnchorsResponse>(`/projects/${projectId}/montage/match-anchors`, { method: 'POST' }),
    updateAnchorMatches: (projectId: string, anchorMatches: AnchorMatch[]) =>
      request<MatchAnchorsResponse>(`/projects/${projectId}/montage/anchor-matches`, {
        method: 'PUT',
        body: JSON.stringify({ anchorMatches }),
      }),
    generatePlan: (projectId: string) =>
      request<{ montagePlan: MontagePlan }>(`/projects/${projectId}/montage/generate-plan`, { method: 'POST' }),
    reorderTimeline: (projectId: string, timeline: { clipId?: string; shotId: string; durationSec: number }[]) =>
      request<{ montagePlan: MontagePlan }>(`/projects/${projectId}/montage/plan/timeline`, {
        method: 'PUT',
        body: JSON.stringify({ timeline }),
      }),
    updateTimelineEntry: (projectId: string, clipId: string, data: { durationSec?: number; trimEndSec?: number; motionEffect?: string | null }) =>
      request<{ montagePlan: MontagePlan }>(`/projects/${projectId}/montage/plan/timeline/${clipId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    updateTransition: (projectId: string, index: number, data: { type?: string; durationSec?: number }) =>
      request<{ montagePlan: MontagePlan }>(`/projects/${projectId}/montage/plan/transitions/${index}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    updateAudioLevels: (projectId: string, audio: Record<string, unknown>) =>
      request<{ montagePlan: MontagePlan }>(`/projects/${projectId}/montage/plan/audio`, {
        method: 'PUT',
        body: JSON.stringify({ audio }),
      }),
    updatePlan: (projectId: string, plan: MontagePlan) =>
      request<Project>(`/projects/${projectId}/montage/plan`, {
        method: 'PUT',
        body: JSON.stringify({ montagePlan: plan }),
      }),
    refinePlan: (projectId: string, feedback: string) =>
      request<{ montagePlan: MontagePlan }>(`/projects/${projectId}/montage/refine-plan`, {
        method: 'POST',
        body: JSON.stringify({ feedback }),
      }),
    render: (projectId: string, quality: 'preview' | 'final') =>
      request<RenderStartResponse>(`/projects/${projectId}/montage/render`, {
        method: 'POST',
        body: JSON.stringify({ quality }),
      }),
    getRenderStatus: (projectId: string, jobId: string) =>
      request<RenderJob>(`/projects/${projectId}/montage/render/${jobId}`),
    getRenderDownloadUrl: (projectId: string, jobId: string) =>
      `${BASE}/projects/${projectId}/montage/render/${jobId}/download`,
  },
}
