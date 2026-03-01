import type {
  ApiErrorResponse,
  Project,
  Shot,
  BriefAsset,
  AppSettings,
  DirectorReview,
  DirectorState,
  VideoGenerationResult,
  MontagePlan,
  RenderJob,
} from '../types/index'

const BASE = '/api'

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[]
    ? DeepPartial<U>[]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K]
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
  assets: {
    upload: async (projectId: string, files: File[]) => {
      const form = new FormData()
      files.forEach((f) => form.append('files', f))
      const path = `/projects/${projectId}/assets`
      const res = await fetch(`${BASE}/projects/${projectId}/assets`, {
        method: 'POST',
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
      request<any>(`/projects/${projectId}/director/apply-feedback`, {
        method: 'POST',
        body: JSON.stringify({ reviewId, action, shotId, shotIds }),
      }),
  },
  export: {
    zipUrl: (projectId: string) => `${BASE}/projects/${projectId}/export`,
    promptsUrl: (projectId: string) => `${BASE}/projects/${projectId}/export/prompts`,
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
    uploadMusic: async (projectId: string, file: File) => {
      const form = new FormData()
      form.append('music', file)
      const path = `/projects/${projectId}/montage/upload-music`
      const res = await fetch(`${BASE}${path}`, { method: 'POST', body: form })
      if (!res.ok) await throwRequestError(res, path)
      return res.json() as Promise<{ musicFile: string; provider: string }>
    },
    musicUrl: (projectId: string) => `${BASE}/projects/${projectId}/montage/music`,
    voiceoverUrl: (projectId: string) => `${BASE}/projects/${projectId}/montage/voiceover`,
    generatePlan: (projectId: string) =>
      request<{ montagePlan: MontagePlan }>(`/projects/${projectId}/montage/generate-plan`, { method: 'POST' }),
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
      request<RenderJob>(`/projects/${projectId}/montage/render`, {
        method: 'POST',
        body: JSON.stringify({ quality }),
      }),
    getRenderStatus: (projectId: string, jobId: string) =>
      request<RenderJob>(`/projects/${projectId}/montage/render/${jobId}`),
    getRenderDownloadUrl: (projectId: string, jobId: string) =>
      `${BASE}/projects/${projectId}/montage/render/${jobId}/download`,
  },
}
