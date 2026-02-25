import fs from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { createProject, deleteProject, resolveProjectPath } from '../../server/lib/storage.js'
import { prepareBriefReference } from '../../server/lib/reference-media.js'

describe('reference-media', () => {
  const createdProjectIds: string[] = []

  afterEach(async () => {
    await Promise.all(createdProjectIds.map((id) => deleteProject(id)))
    createdProjectIds.length = 0
  })

  it('prepares raster references as data URLs when under byte limit', async () => {
    const project = await createProject('Reference Prep Raster')
    createdProjectIds.push(project.id)

    const filePath = resolveProjectPath(project.id, 'brief', 'images', 'ref.png')
    await fs.writeFile(filePath, Buffer.from('png-bytes'))

    const prepared = await prepareBriefReference(project.id, 'ref.png', {
      maxReferenceBytes: 1024,
      includeSvgDataUrl: false,
      includeSvgText: true,
    })

    expect(prepared.skipped).toBe(false)
    expect(prepared.imageDataUrl?.startsWith('data:image/png;base64,')).toBe(true)
    expect(prepared.svgText).toBeUndefined()
  })

  it('marks oversized raster references as skipped', async () => {
    const project = await createProject('Reference Prep Oversize')
    createdProjectIds.push(project.id)

    const filePath = resolveProjectPath(project.id, 'brief', 'images', 'big.png')
    await fs.writeFile(filePath, Buffer.alloc(2048, 1))

    const prepared = await prepareBriefReference(project.id, 'big.png', {
      maxReferenceBytes: 512,
    })

    expect(prepared.skipped).toBe(true)
    expect(prepared.skipReason).toBe('too_large')
    expect(prepared.imageDataUrl).toBeUndefined()
  })

  it('extracts compact SVG text hints when SVG data URL is disabled', async () => {
    const project = await createProject('Reference Prep SVG')
    createdProjectIds.push(project.id)

    const svg = `<!--comment--><svg width="100" height="100">\n  <rect width="50" height="50" />\n</svg>`
    const filePath = resolveProjectPath(project.id, 'brief', 'images', 'layout.svg')
    await fs.writeFile(filePath, svg, 'utf-8')

    const prepared = await prepareBriefReference(project.id, 'layout.svg', {
      includeSvgDataUrl: false,
      includeSvgText: true,
      maxSvgTextChars: 120,
    })

    expect(prepared.skipped).toBe(false)
    expect(prepared.imageDataUrl).toBeUndefined()
    expect(prepared.svgText).toContain('<svg')
    expect(prepared.svgText).toContain('<rect')
  })

  it('returns cached result on repeated calls for the same file', async () => {
    const project = await createProject('Reference Prep Cache')
    createdProjectIds.push(project.id)

    const filePath = resolveProjectPath(project.id, 'brief', 'images', 'cached.png')
    await fs.writeFile(filePath, Buffer.from('cacheable'))

    const first = await prepareBriefReference(project.id, 'cached.png', {
      maxReferenceBytes: 1024,
    })
    const second = await prepareBriefReference(project.id, 'cached.png', {
      maxReferenceBytes: 1024,
    })

    expect(first.fromCache).toBe(false)
    expect(second.fromCache).toBe(true)
    expect(second.imageDataUrl).toBe(first.imageDataUrl)
  })
})

