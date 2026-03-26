export interface OpenReelBundle {
  version: string
  project: unknown
  mediaManifest: Record<string, {
    url: string
    mimeType: string
    kind: 'shot' | 'voiceover' | 'music'
    shotId?: string
  }>
  semanticSummary?: {
    anchors: number
    matched: number
    weak: number
    unmatched: number
  }
  exportArtifact?: {
    filename: string
    exportedAt: number
  }
  modifiedAt?: number
}

export type BridgeMessage =
  | { type: 'cutroom:init'; payload: OpenReelBundle }
  | { type: 'openreel:ready' }
  | { type: 'openreel:project-change'; payload: { version: string; project: unknown } }
  | { type: 'openreel:export-progress'; payload: { phase: string; progress: number } }
  | { type: 'openreel:export-complete'; payload: { filename: string } }
  | { type: 'openreel:error'; payload: { message: string } }

const BRIDGE_MESSAGE_TYPES = new Set<BridgeMessage['type']>([
  'cutroom:init',
  'openreel:ready',
  'openreel:project-change',
  'openreel:export-progress',
  'openreel:export-complete',
  'openreel:error',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isBridgeMessage(value: unknown): value is BridgeMessage {
  if (!isRecord(value)) return false
  if (typeof value.type !== 'string') return false
  return BRIDGE_MESSAGE_TYPES.has(value.type as BridgeMessage['type'])
}

export function postBridgeMessage(
  targetWindow: Window,
  message: BridgeMessage,
  targetOrigin: string = window.location.origin,
): void {
  targetWindow.postMessage(message, targetOrigin)
}

export function attachBridgeListener(
  handler: (message: BridgeMessage, event: MessageEvent<unknown>) => void,
): () => void {
  const listener = (event: MessageEvent<unknown>) => {
    if (!isBridgeMessage(event.data)) return
    handler(event.data, event)
  }

  window.addEventListener('message', listener)
  return () => {
    window.removeEventListener('message', listener)
  }
}
