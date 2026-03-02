import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { ApiRequestError, api } from '../lib/api'
import type { OpenReelBundle } from '../lib/openreel-bridge'
import { OpenReelHost } from '../components/openreel/OpenReelHost'
import type { OpenReelSyncState } from '../components/openreel/OpenReelSyncStatus'

const SAVE_DEBOUNCE_MS = 5000

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError && error.message.trim()) return error.message
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return fallback
}

export function OpenReelEditorPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()

  const [bundle, setBundle] = useState<OpenReelBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [syncStatus, setSyncStatus] = useState<OpenReelSyncState>('synced')
  const [exportStatus, setExportStatus] = useState<string | null>(null)

  const pendingSaveRef = useRef<{ version: string; project: unknown } | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isSavingRef = useRef(false)

  const clearSaveTimer = useCallback(() => {
    if (!saveTimerRef.current) return
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = null
  }, [])

  const flushPendingSave = useCallback(async () => {
    if (!projectId || isSavingRef.current || !pendingSaveRef.current) return

    const payload = pendingSaveRef.current
    pendingSaveRef.current = null
    isSavingRef.current = true

    setSyncStatus('saving')
    setSaveError(null)

    try {
      await api.openreel.saveProject(projectId, payload)
      setSyncStatus('synced')
    } catch (error) {
      setSyncStatus('error')
      setSaveError(getErrorMessage(error, 'Ошибка сохранения'))
    } finally {
      isSavingRef.current = false
      if (!pendingSaveRef.current) return

      clearSaveTimer()
      saveTimerRef.current = setTimeout(() => {
        void flushPendingSave()
      }, SAVE_DEBOUNCE_MS)
    }
  }, [clearSaveTimer, projectId])

  const queueSave = useCallback((payload: { version: string; project: unknown }) => {
    pendingSaveRef.current = payload
    setSyncStatus('saving')
    setSaveError(null)

    clearSaveTimer()
    saveTimerRef.current = setTimeout(() => {
      void flushPendingSave()
    }, SAVE_DEBOUNCE_MS)
  }, [clearSaveTimer, flushPendingSave])

  useEffect(() => {
    let cancelled = false

    setLoadError(null)
    setSaveError(null)
    setExportStatus(null)
    setSyncStatus('synced')
    pendingSaveRef.current = null
    clearSaveTimer()
    isSavingRef.current = false

    if (!projectId) {
      setBundle(null)
      setLoading(false)
      setLoadError('Проект не найден')
      return () => {
        clearSaveTimer()
      }
    }

    setLoading(true)
    void api.openreel.getProject(projectId)
      .then((data) => {
        if (cancelled) return
        setBundle(data)
      })
      .catch((error) => {
        if (cancelled) return
        setBundle(null)
        setLoadError(getErrorMessage(error, 'Ошибка загрузки редактора'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      clearSaveTimer()
    }
  }, [clearSaveTimer, projectId])

  const handleProjectChange = useCallback((payload: { version: string; project: unknown }) => {
    if (payload.version !== '1.0.0') {
      setSyncStatus('error')
      setSaveError('Неподдерживаемая версия проекта')
      return
    }

    setBundle((current) => {
      if (!current) return current
      return {
        ...current,
        version: payload.version,
        project: payload.project,
      }
    })

    queueSave(payload)
  }, [queueSave])

  const goBack = () => {
    if (!projectId) {
      navigate('/')
      return
    }
    navigate(`/projects/${projectId}/montage`)
  }

  const renderBody = () => {
    if (loading) {
      return (
        <div className="bg-surface-2 border-2 border-border rounded-[5px] p-8 flex items-center justify-center gap-2">
          <Loader2 size={18} className="animate-spin text-amber" />
          <p className="font-mono text-xs uppercase tracking-wider text-text-muted">Загружаем редактор...</p>
        </div>
      )
    }

    if (loadError || !bundle) {
      return (
        <div className="bg-rose-dim border-2 border-rose rounded-[5px] p-4 text-sm text-rose">
          <p className="font-semibold">Ошибка загрузки редактора</p>
          {loadError && <p className="mt-1">{loadError}</p>}
        </div>
      )
    }

    return (
      <OpenReelHost
        bundle={bundle}
        syncStatus={syncStatus}
        onProjectChange={handleProjectChange}
        onExportProgress={({ phase, progress }) => {
          setExportStatus(`Экспорт: ${phase} (${Math.round(progress)}%)`)
        }}
        onExportComplete={({ filename }) => {
          setExportStatus(`Экспорт завершён: ${filename}`)
        }}
        onError={(message) => {
          setSyncStatus('error')
          setSaveError(message)
        }}
      />
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-bg min-h-screen">
      <div className="max-w-6xl mx-auto space-y-4">
        <button
          onClick={goBack}
          className="px-4 py-2 bg-surface-2 text-text-secondary border-2 border-border rounded-[5px] font-mono text-xs uppercase tracking-wider hover:border-text-secondary transition-colors"
        >
          ← Вернуться к проекту
        </button>

        {saveError && (
          <div className="bg-rose-dim border-2 border-rose rounded-[5px] p-3 text-sm text-rose">
            {saveError}
          </div>
        )}

        {exportStatus && (
          <div className="bg-surface-2 border-2 border-sky rounded-[5px] p-3 text-xs font-mono uppercase tracking-wider text-sky">
            {exportStatus}
          </div>
        )}

        {renderBody()}
      </div>
    </div>
  )
}

export default OpenReelEditorPage
