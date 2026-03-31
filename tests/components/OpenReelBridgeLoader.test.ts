import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(testDir, '..', '..')
const bridgeLoaderSource = fs.readFileSync(
  path.join(repoRoot, 'server', 'static', 'openreel', 'bridge-loader.js'),
  'utf8',
)

function createBundle() {
  return {
    version: '1.0.0',
    mediaManifest: {
      'media-shot-1': {
        url: '/api/projects/project-1/shots/shot-1/video/clip.mp4',
        mimeType: 'video/mp4',
        kind: 'shot',
        shotId: 'shot-1',
      },
      'media-voiceover': {
        url: '/api/projects/project-1/montage/voiceover',
        mimeType: 'audio/mpeg',
        kind: 'voiceover',
      },
    },
    project: {
      id: 'project-1',
      name: 'Playback hydration',
      createdAt: 0,
      modifiedAt: 0,
      settings: {
        width: 1920,
        height: 1080,
        frameRate: 30,
        sampleRate: 48000,
        channels: 2,
      },
      mediaLibrary: {
        items: [
          {
            id: 'media-shot-1',
            name: 'clip.mp4',
            type: 'video',
            fileHandle: null,
            blob: null,
            metadata: {
              duration: 5,
              width: 1920,
              height: 1080,
              frameRate: 30,
              codec: '',
              sampleRate: 0,
              channels: 0,
              fileSize: 0,
            },
            thumbnailUrl: null,
            waveformData: null,
          },
          {
            id: 'media-voiceover',
            name: 'voiceover.mp3',
            type: 'audio',
            fileHandle: null,
            blob: null,
            metadata: {
              duration: 8,
              width: 0,
              height: 0,
              frameRate: 0,
              codec: '',
              sampleRate: 48000,
              channels: 2,
              fileSize: 0,
            },
            thumbnailUrl: null,
            waveformData: null,
          },
        ],
      },
      timeline: {
        tracks: [],
        subtitles: [],
        duration: 8,
        markers: [],
      },
    },
  }
}

describe('CutRoom OpenReel bridge loader', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      const mimeType = url.includes('voiceover') ? 'audio/mpeg' : 'video/mp4'
      return new Response(new Blob([url], { type: mimeType }), {
        status: 200,
        headers: { 'Content-Type': mimeType },
      })
    }))
  })

  it('clears embedded OpenReel persistence before loading the incoming CutRoom project', async () => {
    const loadProject = vi.fn()
    const unregister = vi.fn(async () => true)
    const deleteCache = vi.fn(async () => true)
    const deleteDatabase = vi.fn((name: string) => {
      const request: {
        onsuccess: null | (() => void)
        onerror: null | (() => void)
        onblocked: null | (() => void)
      } = {
        onsuccess: null,
        onerror: null,
        onblocked: null,
      }

      queueMicrotask(() => {
        request.onsuccess?.()
      })

      return request
    })

    ;(window as typeof window & {
      __OPENREEL_STORE__?: { getState: () => { loadProject: typeof loadProject } }
    }).__OPENREEL_STORE__ = {
      getState: () => ({ loadProject }),
    }

    Object.defineProperty(window.navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistrations: vi.fn(async () => [{ unregister }]),
      },
    })

    vi.stubGlobal('caches', {
      keys: vi.fn(async () => ['openreel-static-v1', 'other-cache']),
      delete: deleteCache,
    })

    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: {
        deleteDatabase,
      },
    })

    window.eval(bridgeLoaderSource)

    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      data: {
        type: 'cutroom:init',
        payload: createBundle(),
      },
    }))

    await waitFor(() => {
      expect(loadProject).toHaveBeenCalledTimes(1)
    })

    expect(unregister).toHaveBeenCalledTimes(1)
    expect(deleteCache).toHaveBeenCalledWith('openreel-static-v1')
    expect(deleteDatabase).toHaveBeenCalledWith('openreel-projects')
    expect(deleteDatabase).toHaveBeenCalledWith('openreel-autosave')
    expect(deleteDatabase).toHaveBeenCalledWith('openreel-db')
  })

  it('hydrates media items from CutRoom mediaManifest before loading the project into OpenReel', async () => {
    const loadProject = vi.fn()

    ;(window as typeof window & {
      __OPENREEL_STORE__?: { getState: () => { loadProject: typeof loadProject } }
    }).__OPENREEL_STORE__ = {
      getState: () => ({ loadProject }),
    }

    window.eval(bridgeLoaderSource)

    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      data: {
        type: 'cutroom:init',
        payload: createBundle(),
      },
    }))

    await waitFor(() => {
      expect(loadProject).toHaveBeenCalledTimes(1)
    })

    const hydratedProject = loadProject.mock.calls[0][0]
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(hydratedProject.mediaLibrary.items[0].blob).toBeInstanceOf(Blob)
    expect(hydratedProject.mediaLibrary.items[0].originalUrl).toBe('/api/projects/project-1/shots/shot-1/video/clip.mp4')
    expect(hydratedProject.mediaLibrary.items[1].blob).toBeInstanceOf(Blob)
    expect(hydratedProject.mediaLibrary.items[1].originalUrl).toBe('/api/projects/project-1/montage/voiceover')
  })
})
