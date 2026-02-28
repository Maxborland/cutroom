import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
}))

function makeBodyStream(data: string): ReadableStream<Uint8Array> {
  const bytes = new Uint8Array(Buffer.from(data))
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}
import {
  createProject,
  deleteProject,
  getProject,
  getProjectDir,
  saveProject,
  type ShotMeta,
} from '../../server/lib/storage'
import { recoverExternalImageReferencesOnStartup } from '../../server/lib/external-image-cache.js'

const createdIds: string[] = []

function makeShot(id: string, generated: string[], enhanced: string[]): ShotMeta {
  return {
    id,
    order: 0,
    scene: 'Scene',
    audioDescription: '',
    imagePrompt: '',
    videoPrompt: '',
    duration: 5,
    assetRefs: [],
    status: 'img_review',
    generatedImages: generated,
    enhancedImages: enhanced,
    selectedImage: null,
    videoFile: null,
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  for (const id of createdIds) {
    await deleteProject(id)
  }
  createdIds.length = 0
})

describe('external image cache startup recovery', () => {
  it('caches external references into local generated files', async () => {
    const project = await createProject('Recovery success')
    createdIds.push(project.id)

    const httpRef = 'https://fal.example/image-1.png'
    const dataRef = `data:image/png;base64,${Buffer.from('inline-image').toString('base64')}`

    project.shots = [makeShot('shot-001', [httpRef], [dataRef])]
    await saveProject(project)

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: makeBodyStream('http-image'),
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const summary = await recoverExternalImageReferencesOnStartup([project.id])
    expect(summary.referencesFound).toBe(2)
    expect(summary.cachedCount).toBe(2)
    expect(summary.failedCount).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const updated = await getProject(project.id)
    expect(updated).not.toBeNull()
    const shot = updated!.shots[0]

    expect(shot.generatedImages[0]).not.toBe(httpRef)
    expect(shot.generatedImages[0]).toMatch(/^img_cached_.*\.png$/)

    expect(shot.enhancedImages[0]).not.toBe(dataRef)
    expect(shot.enhancedImages[0]).toMatch(/^img_cached_.*\.png$/)

    const generatedPath = path.join(getProjectDir(project.id), 'shots', shot.id, 'generated', shot.generatedImages[0])
    const enhancedPath = path.join(getProjectDir(project.id), 'shots', shot.id, 'generated', shot.enhancedImages[0])

    await expect(fs.access(generatedPath)).resolves.toBeUndefined()
    await expect(fs.access(enhancedPath)).resolves.toBeUndefined()
  })

  it('keeps external refs when download fails', async () => {
    const project = await createProject('Recovery failure')
    createdIds.push(project.id)

    const httpRef = 'https://fal.example/broken-image.png'
    project.shots = [makeShot('shot-001', [httpRef], [])]
    await saveProject(project)

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const summary = await recoverExternalImageReferencesOnStartup([project.id])
    expect(summary.referencesFound).toBe(1)
    expect(summary.cachedCount).toBe(0)
    expect(summary.failedCount).toBe(1)

    const updated = await getProject(project.id)
    expect(updated).not.toBeNull()
    expect(updated!.shots[0].generatedImages[0]).toBe(httpRef)
  })
})
