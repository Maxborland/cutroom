import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveImageResult } from '../../server/lib/media-utils.js'

describe('media-utils saveImageResult', () => {
  const tmpDirs: string[] = []

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(tmpDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
    tmpDirs.length = 0
  })

  it('retries downloading http result when fetch fails with terminated/ECONNRESET', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'save-image-retry-'))
    tmpDirs.push(tmpDir)
    const target = path.join(tmpDir, 'image.png')

    const resetError = new TypeError('terminated') as any
    resetError.cause = { code: 'ECONNRESET' }

    const fetchMock = vi.fn()
      .mockRejectedValueOnce(resetError)
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => Buffer.from('ok-image-bytes'),
      })

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    await saveImageResult('https://fal.example/output.png', target)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const written = await fs.readFile(target)
    expect(written.toString('utf-8')).toBe('ok-image-bytes')
  })

  it('retries when response body download fails with terminated/ECONNRESET', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'save-image-body-retry-'))
    tmpDirs.push(tmpDir)
    const target = path.join(tmpDir, 'image.png')

    const resetError = new TypeError('terminated') as any
    resetError.cause = { code: 'ECONNRESET' }

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => {
          throw resetError
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => Buffer.from('ok-after-body-retry'),
      })

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    await saveImageResult('https://fal.example/output.png', target)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const written = await fs.readFile(target)
    expect(written.toString('utf-8')).toBe('ok-after-body-retry')
  })
})
