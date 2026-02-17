const BASE = '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  projects: {
    list: () => request<any[]>('/projects'),
    get: (id: string) => request<any>(`/projects/${id}`),
    create: (name: string) =>
      request<any>('/projects', { method: 'POST', body: JSON.stringify({ name }) }),
    update: (id: string, data: any) =>
      request<any>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),
  },
  assets: {
    upload: async (projectId: string, files: File[]) => {
      const form = new FormData()
      files.forEach((f) => form.append('files', f))
      const res = await fetch(`${BASE}/projects/${projectId}/assets`, {
        method: 'POST',
        body: form,
      })
      if (!res.ok) throw new Error('Upload failed')
      return res.json()
    },
    delete: (projectId: string, assetId: string) =>
      request<void>(`/projects/${projectId}/assets/${assetId}`, { method: 'DELETE' }),
    url: (projectId: string, filename: string) =>
      `${BASE}/projects/${projectId}/assets/file/${encodeURIComponent(filename)}`,
    updateLabel: (projectId: string, assetId: string, label: string) =>
      request<any>(`/projects/${projectId}/assets/${assetId}/label`, {
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
      request<{ shots: any[] }>(`/projects/${projectId}/split-shots`, { method: 'POST' }),
    image: (projectId: string, shotId: string) =>
      request<any>(`/projects/${projectId}/shots/${shotId}/generate-image`, { method: 'POST' }),
    cancelImage: (projectId: string, shotId: string) =>
      request<any>(`/projects/${projectId}/shots/${shotId}/cancel-generation`, { method: 'POST' }),
    cancelAll: (projectId: string) =>
      request<any>(`/projects/${projectId}/cancel-all-generation`, { method: 'POST' }),
    enhance: (projectId: string, shotId: string, sourceImage: string) =>
      request<{ filename: string; url: string }>(`/projects/${projectId}/shots/${shotId}/enhance-image`, {
        method: 'POST',
        body: JSON.stringify({ sourceImage }),
      }),
    enhanceAll: (projectId: string) =>
      request<{ enhanced: number; total: number }>(`/projects/${projectId}/enhance-all`, { method: 'POST' }),
    video: (projectId: string, shotId: string) =>
      request<{ filename: string; url: string }>(`/projects/${projectId}/shots/${shotId}/generate-video`, { method: 'POST' }),
    allVideos: (projectId: string) =>
      request<{ generated: number; total: number }>(`/projects/${projectId}/generate-all-videos`, { method: 'POST' }),
  },
  shots: {
    update: (projectId: string, shotId: string, data: any) =>
      request<any>(`/projects/${projectId}/shots/${shotId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    setStatus: (projectId: string, shotId: string, status: string) =>
      request<any>(`/projects/${projectId}/shots/${shotId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      }),
    uploadVideo: async (projectId: string, shotId: string, file: File) => {
      const form = new FormData()
      form.append('video', file)
      const res = await fetch(`${BASE}/projects/${projectId}/shots/${shotId}/video`, {
        method: 'POST',
        body: form,
      })
      if (!res.ok) throw new Error('Upload failed')
      return res.json()
    },
    generatedImageUrl: (projectId: string, shotId: string, filename: string) =>
      `${BASE}/projects/${projectId}/shots/${shotId}/generated/${encodeURIComponent(filename)}`,
    videoUrl: (projectId: string, shotId: string, filename: string) =>
      `${BASE}/projects/${projectId}/shots/${shotId}/video/${encodeURIComponent(filename)}`,
  },
  settings: {
    get: () => request<any>('/settings'),
    update: (data: any) => request<any>('/settings', { method: 'PUT', body: JSON.stringify(data) }),
  },
  models: {
    list: () => request<{
      textModels: { id: string; name: string }[];
      imageModels: { id: string; name: string }[];
      higgsfieldImageModels: { id: string; name: string }[];
      higgsfieldVideoModels: { id: string; name: string }[];
    }>('/models'),
  },
  export: {
    zipUrl: (projectId: string) => `${BASE}/projects/${projectId}/export`,
    promptsUrl: (projectId: string) => `${BASE}/projects/${projectId}/export/prompts`,
  },
}
