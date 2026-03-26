import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { ApiRequestError, api, type OpenReelSaveProjectPayload } from '../lib/api'
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

function formatSemanticSummary(summary: NonNullable<OpenReelBundle['semanticSummary']>): string {
  const strongPart = `${summary.matched} ${summary.matched === 1 ? 'сильное' : 'сильных'}`
  const reviewPart = `${summary.weak} ${summary.weak === 1 ? 'требует проверки' : 'требуют проверки'}`
  const unmatchedPart = summary.unmatched > 0
    ? `, ${summary.unmatched} ${summary.unmatched === 1 ? 'остается без совпадения' : 'остаются без совпадений'}`
    : ''

  return `${strongPart}, ${reviewPart}${unmatchedPart}`
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

  const pendingSaveRef = useRef<OpenReelSaveProjectPayload | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isSavingRef = useRef(false)
  const bundleRef = useRef<OpenReelBundle | null>(null)

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
    let shouldReschedule = false

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
      shouldReschedule = Boolean(pendingSaveRef.current)
    }

    if (!shouldReschedule) return

    clearSaveTimer()
    saveTimerRef.current = setTimeout(() => {
      void flushPendingSave()
    }, SAVE_DEBOUNCE_MS)
  }, [clearSaveTimer, projectId])

  const queueSave = useCallback((payload: OpenReelSaveProjectPayload) => {
    pendingSaveRef.current = payload
    setSyncStatus('saving')
    setSaveError(null)

    clearSaveTimer()
    saveTimerRef.current = setTimeout(() => {
      void flushPendingSave()
    }, SAVE_DEBOUNCE_MS)
  }, [clearSaveTimer, flushPendingSave])

  useEffect(() => {
    bundleRef.current = bundle
  }, [bundle])

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
      // Flush any pending save on unmount/navigation
      if (pendingSaveRef.current && !isSavingRef.current) {
        const payload = pendingSaveRef.current
        pendingSaveRef.current = null
        void api.openreel.saveProject(projectId!, payload).catch(() => {})
      }
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

    queueSave({
      ...payload,
      ...(bundleRef.current?.exportArtifact
        ? { exportArtifact: { filename: bundleRef.current.exportArtifact.filename } }
        : {}),
    })
  }, [queueSave])

  const handleExportComplete = useCallback(async ({ filename }: { filename: string }) => {
    if (!projectId || !bundleRef.current) {
      setExportStatus(`Экспорт завершён: ${filename}`)
      return
    }

    clearSaveTimer()
    pendingSaveRef.current = null
    isSavingRef.current = true
    setSyncStatus('saving')
    setSaveError(null)

    try {
      const response = await api.openreel.saveProject(projectId, {
        version: bundleRef.current.version,
        project: bundleRef.current.project,
        exportArtifact: {
          filename,
        },
      })

      const nextBundle = {
        ...bundleRef.current,
        exportArtifact: response.exportArtifact ?? {
          filename,
          exportedAt: response.modifiedAt,
        },
      }

      bundleRef.current = nextBundle
      setBundle(nextBundle)
      setSyncStatus('synced')
      setExportStatus(`Экспорт завершён и сохранён в проекте: ${filename}`)
    } catch (error) {
      setSyncStatus('error')
      setSaveError(getErrorMessage(error, 'Ошибка сохранения экспорта'))
      setExportStatus(`Экспорт завершён: ${filename}`)
    } finally {
      isSavingRef.current = false
    }
  }, [clearSaveTimer, projectId])

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
      <div className="space-y-4">
        {bundle.semanticSummary && (
          <div className="bg-surface-2 border-2 border-emerald rounded-[5px] p-4 space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-wider text-emerald">
              Черновик из монтажного плана
            </p>
            <p className="text-sm text-text-primary">
              {formatSemanticSummary(bundle.semanticSummary)}
            </p>
            <p className="text-xs text-text-secondary">
              Откройте монтажный черновик в OpenReel, чтобы доработать клипы и синхронизировать правки с проектом.
            </p>
          </div>
        )}

        {bundle.exportArtifact && (
          <div className="bg-surface-2 border-2 border-sky rounded-[5px] p-4 space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-wider text-sky">
              Последний экспорт из редактора
            </p>
            <p className="text-sm text-text-primary">
              Файл: {bundle.exportArtifact.filename}
            </p>
            <p className="text-xs text-text-secondary">
              Экспорт сохранён в CutRoom и отмечен как последний готовый артефакт проекта.
            </p>
          </div>
        )}

        <OpenReelHost
          bundle={bundle}
          syncStatus={syncStatus}
          onProjectChange={handleProjectChange}
          onExportProgress={({ phase, progress }) => {
            setExportStatus(`Экспорт: ${phase} (${Math.round(progress)}%)`)
          }}
          onExportComplete={handleExportComplete}
          onError={(message) => {
            setSyncStatus('error')
            setSaveError(message)
          }}
        />
      </div>
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
