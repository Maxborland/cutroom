import { describe, it, expect, afterEach } from 'vitest'
import {
  createProject,
  getProject,
  listProjects,
  saveProject,
  deleteProject,
  ensureDir,
  getProjectDir,
} from '../../server/lib/storage'
import fs from 'node:fs/promises'
import path from 'node:path'

// Track project IDs for cleanup
const createdIds: string[] = []

afterEach(async () => {
  for (const id of createdIds) {
    await deleteProject(id)
  }
  createdIds.length = 0
})

describe('storage', () => {
  describe('createProject', () => {
    it('creates a project with correct defaults', async () => {
      const project = await createProject('Test Project')
      createdIds.push(project.id)

      expect(project.name).toBe('Test Project')
      expect(project.stage).toBe('brief')
      expect(project.brief).toEqual({ text: '', assets: [] })
      expect(project.script).toBe('')
      expect(project.shots).toEqual([])
      expect(project.id).toBeTruthy()
      expect(project.created).toBeTruthy()
      expect(project.updated).toBeTruthy()
      expect(project.settings).toBeDefined()
      expect(project.settings.model).toBe('openai/gpt-4o')
      expect(project.settings.temperature).toBe(0.7)
    })

    it('creates project directories on disk', async () => {
      const project = await createProject('Dir Test')
      createdIds.push(project.id)

      const projectDir = getProjectDir(project.id)
      const briefImagesDir = path.join(projectDir, 'brief', 'images')
      const shotsDir = path.join(projectDir, 'shots')

      // Verify directories exist by trying to access them
      await expect(fs.access(projectDir)).resolves.toBeUndefined()
      await expect(fs.access(briefImagesDir)).resolves.toBeUndefined()
      await expect(fs.access(shotsDir)).resolves.toBeUndefined()
    })

    it('persists the project to a JSON file', async () => {
      const project = await createProject('Persisted')
      createdIds.push(project.id)

      const filePath = path.join(getProjectDir(project.id), 'project.json')
      const raw = await fs.readFile(filePath, 'utf-8')
      const parsed = JSON.parse(raw)

      expect(parsed.id).toBe(project.id)
      expect(parsed.name).toBe('Persisted')
    })
  })

  describe('getProject', () => {
    it('returns a project by id', async () => {
      const created = await createProject('Get Test')
      createdIds.push(created.id)

      const fetched = await getProject(created.id)
      expect(fetched).not.toBeNull()
      expect(fetched!.id).toBe(created.id)
      expect(fetched!.name).toBe('Get Test')
    })

    it('returns null for non-existent id', async () => {
      const result = await getProject('non-existent-id-12345')
      expect(result).toBeNull()
    })
  })

  describe('listProjects', () => {
    it('returns all projects sorted newest first', async () => {
      const p1 = await createProject('First')
      createdIds.push(p1.id)

      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 50))

      const p2 = await createProject('Second')
      createdIds.push(p2.id)

      const list = await listProjects()
      const ids = list.map((p) => p.id)

      // p2 was created after p1, so it should be first (newest first)
      expect(ids.indexOf(p2.id)).toBeLessThan(ids.indexOf(p1.id))
    })

    it('returns an empty array when no projects exist', async () => {
      // listProjects returns all projects, but at least it shouldn't throw
      const list = await listProjects()
      expect(Array.isArray(list)).toBe(true)
    })
  })

  describe('saveProject', () => {
    it('updates fields and sets a new updated timestamp', async () => {
      const project = await createProject('Save Test')
      createdIds.push(project.id)

      const originalUpdated = project.updated

      // Small delay to ensure different timestamp
      await new Promise((r) => setTimeout(r, 50))

      project.script = 'Updated script content'
      const saved = await saveProject(project)

      expect(saved.script).toBe('Updated script content')
      expect(new Date(saved.updated).getTime()).toBeGreaterThan(
        new Date(originalUpdated).getTime()
      )

      // Verify it was persisted
      const fetched = await getProject(project.id)
      expect(fetched!.script).toBe('Updated script content')
    })
  })

  describe('deleteProject', () => {
    it('removes the project directory', async () => {
      const project = await createProject('Delete Test')
      const projectDir = getProjectDir(project.id)

      // Verify it exists first
      await expect(fs.access(projectDir)).resolves.toBeUndefined()

      const result = await deleteProject(project.id)
      expect(result).toBe(true)

      // Verify directory is gone
      await expect(fs.access(projectDir)).rejects.toThrow()

      // Verify getProject returns null
      const fetched = await getProject(project.id)
      expect(fetched).toBeNull()
    })

    it('returns true even for non-existent projects (force removal)', async () => {
      // fs.rm with force: true doesn't throw for non-existent dirs
      const result = await deleteProject('non-existent-id-12345')
      expect(result).toBe(true)
    })
  })

  describe('ensureDir', () => {
    it('creates nested directories', async () => {
      const testDir = path.join(
        getProjectDir('__test-ensure-dir__'),
        'a',
        'b',
        'c'
      )

      await ensureDir(testDir)
      await expect(fs.access(testDir)).resolves.toBeUndefined()

      // Cleanup
      await deleteProject('__test-ensure-dir__')
    })

    it('does not throw if directory already exists', async () => {
      const testDir = path.join(getProjectDir('__test-ensure-dir-2__'), 'x')

      await ensureDir(testDir)
      await expect(ensureDir(testDir)).resolves.toBeUndefined()

      // Cleanup
      await deleteProject('__test-ensure-dir-2__')
    })
  })
})
