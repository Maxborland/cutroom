import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { OpenReelHost } from '../../src/components/openreel/OpenReelHost'
import { attachBridgeListener, postBridgeMessage } from '../../src/lib/openreel-bridge'

vi.mock('../../src/lib/openreel-bridge', () => ({
  attachBridgeListener: vi.fn(() => () => {}),
  postBridgeMessage: vi.fn(),
}))

const mockBundle = {
  version: '1.0.0',
  project: { id: 'project-1', timeline: { tracks: [] } },
  mediaManifest: {},
}

describe('OpenReelHost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the editor host as a fullscreen-ready surface', () => {
    render(
      <div className="h-screen">
        <OpenReelHost
          bundle={mockBundle}
          syncStatus="synced"
          onProjectChange={() => {}}
        />
      </div>,
    )

    const section = screen.getByTestId('openreel-host-shell')
    const viewport = screen.getByTestId('openreel-host-viewport')
    const iframe = screen.getByTitle('Редактор OpenReel')

    expect(section.className).toContain('h-full')
    expect(section.className).toContain('min-h-0')
    expect(viewport.className).toContain('flex-1')
    expect(viewport.className).toContain('min-h-0')
    expect(iframe.className).toContain('h-full')
    expect(iframe.className).not.toContain('h-[70vh]')
  })

  it('sends init only once during the initial load handshake', async () => {
    const detach = vi.fn()
    let bridgeHandler: ((message: { type: string }, event: MessageEvent<unknown>) => void) | null = null

    vi.mocked(attachBridgeListener).mockImplementation((handler) => {
      bridgeHandler = handler as typeof bridgeHandler
      return detach
    })

    render(
      <div className="h-screen">
        <OpenReelHost
          bundle={mockBundle}
          syncStatus="synced"
          onProjectChange={() => {}}
        />
      </div>,
    )

    const iframe = screen.getByTitle('Редактор OpenReel') as HTMLIFrameElement
    const frameWindow = { postMessage: vi.fn() } as unknown as Window
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      value: frameWindow,
    })

    fireEvent.load(iframe)

    expect(postBridgeMessage).not.toHaveBeenCalled()
    expect(bridgeHandler).toBeTypeOf('function')

    await act(async () => {
      bridgeHandler?.(
        { type: 'openreel:ready' },
        { source: frameWindow } as MessageEvent<unknown>,
      )
    })

    await waitFor(() => {
      expect(postBridgeMessage).toHaveBeenCalledTimes(1)
    })
  })

  it('does not regress back to placeholder when ready arrives before iframe load completes', async () => {
    vi.useFakeTimers()

    const detach = vi.fn()
    let bridgeHandler: ((message: { type: string }, event: MessageEvent<unknown>) => void) | null = null

    vi.mocked(attachBridgeListener).mockImplementation((handler) => {
      bridgeHandler = handler as typeof bridgeHandler
      return detach
    })

    render(
      <div className="h-screen">
        <OpenReelHost
          bundle={mockBundle}
          syncStatus="synced"
          onProjectChange={() => {}}
          onError={() => {}}
        />
      </div>,
    )

    const iframe = screen.getByTitle('Редактор OpenReel') as HTMLIFrameElement
    const frameWindow = { postMessage: vi.fn() } as unknown as Window
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      value: frameWindow,
    })

    await act(async () => {
      bridgeHandler?.(
        { type: 'openreel:ready' },
        { source: frameWindow } as MessageEvent<unknown>,
      )
    })

    fireEvent.load(iframe)

    await act(async () => {
      vi.advanceTimersByTime(4500)
    })

    expect(screen.queryByText('Редактор пока недоступен')).not.toBeInTheDocument()
    vi.useRealTimers()
  })
})
