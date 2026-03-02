import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  attachBridgeListener,
  postBridgeMessage,
  type OpenReelBundle,
} from '../../lib/openreel-bridge'
import { OpenReelSyncStatus, type OpenReelSyncState } from './OpenReelSyncStatus'

const OPENREEL_READY_TIMEOUT_MS = 4000
const DEFAULT_EDITOR_URL = (import.meta.env.VITE_OPENREEL_EDITOR_URL as string | undefined) ?? '/openreel/index.html'

function deriveOrigin(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin)
    return parsed.origin
  } catch {
    return window.location.origin
  }
}

interface OpenReelHostProps {
  bundle: OpenReelBundle
  syncStatus: OpenReelSyncState
  onProjectChange: (payload: { version: string; project: unknown }) => void
  onExportProgress?: (payload: { phase: string; progress: number }) => void
  onExportComplete?: (payload: { filename: string }) => void
  onError?: (message: string) => void
}

export function OpenReelHost({
  bundle,
  syncStatus,
  onProjectChange,
  onExportProgress,
  onExportComplete,
  onError,
}: OpenReelHostProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const readyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isReadyRef = useRef(false)

  const [isEditorReady, setIsEditorReady] = useState(false)
  const [showPlaceholder, setShowPlaceholder] = useState(false)
  const [iframeKey, setIframeKey] = useState(0)

  const clearReadyTimeout = useCallback(() => {
    if (!readyTimeoutRef.current) return
    clearTimeout(readyTimeoutRef.current)
    readyTimeoutRef.current = null
  }, [])

  const sendInitBundle = useCallback(() => {
    const targetWindow = iframeRef.current?.contentWindow
    if (!targetWindow) return

    const origin = deriveOrigin(DEFAULT_EDITOR_URL)
    postBridgeMessage(targetWindow, {
      type: 'cutroom:init',
      payload: bundle,
    }, origin)
  }, [bundle])

  useEffect(() => {
    isReadyRef.current = isEditorReady
  }, [isEditorReady])

  useEffect(() => {
    return attachBridgeListener((message, event) => {
      if (event.source !== iframeRef.current?.contentWindow) return

      switch (message.type) {
        case 'openreel:ready':
          setIsEditorReady(true)
          setShowPlaceholder(false)
          clearReadyTimeout()
          sendInitBundle()
          break
        case 'openreel:project-change':
          onProjectChange(message.payload)
          break
        case 'openreel:export-progress':
          onExportProgress?.(message.payload)
          break
        case 'openreel:export-complete':
          onExportComplete?.(message.payload)
          break
        case 'openreel:error':
          onError?.(message.payload.message)
          break
        default:
          break
      }
    })
  }, [clearReadyTimeout, onError, onExportComplete, onExportProgress, onProjectChange, sendInitBundle])

  useEffect(() => {
    if (!isEditorReady) return
    sendInitBundle()
  }, [bundle, isEditorReady, sendInitBundle])

  useEffect(() => {
    return () => {
      clearReadyTimeout()
    }
  }, [clearReadyTimeout])

  const handleFrameLoad = () => {
    setIsEditorReady(false)
    setShowPlaceholder(false)
    sendInitBundle()

    clearReadyTimeout()
    readyTimeoutRef.current = setTimeout(() => {
      if (isReadyRef.current) return
      setShowPlaceholder(true)
      onError?.('Редактор OpenReel не отвечает. Возможно, он ещё не собран.')
    }, OPENREEL_READY_TIMEOUT_MS)
  }

  const handleFrameError = () => {
    setShowPlaceholder(true)
    setIsEditorReady(false)
    clearReadyTimeout()
    onError?.('Редактор OpenReel недоступен.')
  }

  const retryConnection = () => {
    setShowPlaceholder(false)
    setIsEditorReady(false)
    setIframeKey((prev) => prev + 1)
  }

  return (
    <section className="bg-surface-2 border-2 border-border rounded-[5px] p-4 shadow-brutal-sm space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-heading font-semibold text-base">Редактор OpenReel</h2>
        <OpenReelSyncStatus status={syncStatus} />
      </div>

      <div className="relative min-h-[520px] rounded-[5px] border-2 border-border overflow-hidden bg-surface-1">
        {!showPlaceholder && (
          <iframe
            key={iframeKey}
            ref={iframeRef}
            title="Редактор OpenReel"
            src={DEFAULT_EDITOR_URL}
            onLoad={handleFrameLoad}
            onError={handleFrameError}
            className="h-[70vh] w-full bg-white"
          />
        )}

        {!showPlaceholder && !isEditorReady && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-surface-1/95">
            <Loader2 size={18} className="animate-spin text-amber" />
            <span className="font-mono text-xs uppercase tracking-wider text-text-muted">
              Подключаем редактор...
            </span>
          </div>
        )}

        {showPlaceholder && (
          <div className="h-[70vh] flex items-center justify-center p-6">
            <div className="max-w-xl w-full text-center space-y-4">
              <h3 className="font-heading font-bold text-lg">Редактор пока недоступен</h3>
              <p className="text-sm text-text-muted">
                Соберите OpenReel командой <code className="font-mono">npm run openreel:build</code>
                {' '}или задайте URL через <code className="font-mono">VITE_OPENREEL_EDITOR_URL</code>.
              </p>
              <button
                onClick={retryConnection}
                className="px-4 py-2 bg-amber text-black border-2 border-amber rounded-[5px] font-mono text-xs uppercase tracking-wider shadow-brutal-sm hover:translate-y-[1px] hover:shadow-none transition-all"
              >
                Повторить
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
