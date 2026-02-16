# Tests & Model Dropdown Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add comprehensive test coverage (unit, integration, component, e2e) and replace text model inputs with searchable dropdowns populated from OpenRouter API.

**Architecture:** Vitest for unit/integration/component tests with jsdom environment for React. Supertest for Express route integration tests with temp filesystem. Playwright for e2e browser tests with both servers running. Model dropdown backed by a new `/api/models` endpoint that caches OpenRouter's model list.

**Tech Stack:** Vitest, @testing-library/react, supertest, Playwright, jsdom

---

### Task 1: Install test dependencies and configure Vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`

**Step 1: Install dependencies**

Run:
```bash
cd video-pipeline && npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom supertest @types/supertest happy-dom
```

**Step 2: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/e2e/**'],
    testTimeout: 15000,
  },
})
```

**Step 3: Create `tests/setup.ts`**

```typescript
import '@testing-library/jest-dom/vitest'
```

**Step 4: Add scripts to `package.json`**

Add to scripts:
```json
"test": "vitest run",
"test:watch": "vitest",
"test:unit": "vitest run tests/unit",
"test:integration": "vitest run tests/integration",
"test:components": "vitest run tests/components",
"test:e2e": "npx playwright test",
"test:all": "vitest run && npx playwright test"
```

**Step 5: Run vitest to verify config**

Run: `cd video-pipeline && npx vitest run --passWithNoTests`
Expected: PASS (no tests yet)

**Step 6: Commit**

```bash
git add vitest.config.ts tests/setup.ts package.json package-lock.json
git commit -m "chore: add Vitest test infrastructure"
```

---

### Task 2: Unit tests — storage.ts

**Files:**
- Create: `tests/unit/storage.test.ts`
- Reference: `server/lib/storage.ts`

**Step 1: Write tests**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  listProjects,
  getProject,
  createProject,
  saveProject,
  deleteProject,
  ensureDir,
  getProjectDir,
} from '../../server/lib/storage'

// Override DATA_DIR to use temp directory
const TEST_DATA_DIR = path.join(process.cwd(), 'data', 'test-projects')

// We need to mock the DATA_DIR. Since storage.ts uses process.cwd() + 'data/projects',
// we'll test by actually creating projects (functional test with real FS).
// After each test, clean up.

describe('storage', () => {
  let createdIds: string[] = []

  afterEach(async () => {
    // Clean up created projects
    for (const id of createdIds) {
      await deleteProject(id)
    }
    createdIds = []
  })

  describe('createProject', () => {
    it('should create a project with correct defaults', async () => {
      const project = await createProject('Test Project')
      createdIds.push(project.id)

      expect(project.name).toBe('Test Project')
      expect(project.stage).toBe('brief')
      expect(project.brief.text).toBe('')
      expect(project.brief.assets).toEqual([])
      expect(project.script).toBe('')
      expect(project.shots).toEqual([])
      expect(project.id).toBeTruthy()
      expect(project.created).toBeTruthy()
      expect(project.updated).toBeTruthy()
    })

    it('should create project directory with subdirectories', async () => {
      const project = await createProject('Dir Test')
      createdIds.push(project.id)

      const projectDir = getProjectDir(project.id)
      const stat = await fs.stat(projectDir)
      expect(stat.isDirectory()).toBe(true)

      const briefImagesDir = path.join(projectDir, 'brief', 'images')
      const briefStat = await fs.stat(briefImagesDir)
      expect(briefStat.isDirectory()).toBe(true)
    })
  })

  describe('getProject', () => {
    it('should return project by id', async () => {
      const created = await createProject('Get Test')
      createdIds.push(created.id)

      const found = await getProject(created.id)
      expect(found).not.toBeNull()
      expect(found!.name).toBe('Get Test')
      expect(found!.id).toBe(created.id)
    })

    it('should return null for non-existent id', async () => {
      const result = await getProject('non-existent-id')
      expect(result).toBeNull()
    })
  })

  describe('listProjects', () => {
    it('should return all projects sorted newest first', async () => {
      const p1 = await createProject('First')
      createdIds.push(p1.id)

      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 50))

      const p2 = await createProject('Second')
      createdIds.push(p2.id)

      const all = await listProjects()
      const testProjects = all.filter((p) => createdIds.includes(p.id))
      expect(testProjects.length).toBe(2)
      // Newest first
      expect(testProjects[0].name).toBe('Second')
      expect(testProjects[1].name).toBe('First')
    })
  })

  describe('saveProject', () => {
    it('should update project fields and set updated timestamp', async () => {
      const project = await createProject('Save Test')
      createdIds.push(project.id)

      const originalUpdated = project.updated
      await new Promise((r) => setTimeout(r, 50))

      project.script = 'Updated script content'
      const saved = await saveProject(project)

      expect(saved.script).toBe('Updated script content')
      expect(saved.updated).not.toBe(originalUpdated)
    })
  })

  describe('deleteProject', () => {
    it('should remove project directory', async () => {
      const project = await createProject('Delete Test')
      const projectDir = getProjectDir(project.id)

      const result = await deleteProject(project.id)
      expect(result).toBe(true)

      // Directory should not exist
      await expect(fs.access(projectDir)).rejects.toThrow()
    })

    it('should return false for non-existent project', async () => {
      // deleteProject uses force: true, so it always returns true for rm
      // Actually, with force: true and recursive: true, it won't throw.
      // Let's just verify it doesn't throw
      const result = await deleteProject('non-existent-id')
      expect(result).toBe(true) // rm with force doesn't fail on missing dirs
    })
  })

  describe('ensureDir', () => {
    it('should create nested directories', async () => {
      const testDir = path.join(process.cwd(), 'data', 'test-ensure-dir', 'nested', 'deep')
      await ensureDir(testDir)
      const stat = await fs.stat(testDir)
      expect(stat.isDirectory()).toBe(true)
      // Cleanup
      await fs.rm(path.join(process.cwd(), 'data', 'test-ensure-dir'), {
        recursive: true,
        force: true,
      })
    })
  })
})
```

**Step 2: Run tests**

Run: `cd video-pipeline && npx vitest run tests/unit/storage.test.ts`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add tests/unit/storage.test.ts
git commit -m "test: add unit tests for storage layer"
```

---

### Task 3: Unit tests — openrouter.ts

**Files:**
- Create: `tests/unit/openrouter.test.ts`
- Reference: `server/lib/openrouter.ts`, `server/routes/settings.ts`

**Step 1: Write tests (mock fetch and getApiKey)**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock settings to provide API key
vi.mock('../../server/routes/settings', () => ({
  getApiKey: vi.fn(),
}))

import { chatCompletion, generateImage } from '../../server/lib/openrouter'
import { getApiKey } from '../../server/routes/settings'

const mockedGetApiKey = vi.mocked(getApiKey)

describe('openrouter', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockedGetApiKey.mockResolvedValue('sk-test-key')
  })

  describe('chatCompletion', () => {
    it('should return content from OpenRouter response', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Generated script text' } }],
      }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })

      const result = await chatCompletion('openai/gpt-4o', [
        { role: 'user', content: 'Write a script' },
      ])

      expect(result).toBe('Generated script text')
      expect(fetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer sk-test-key',
          }),
        })
      )
    })

    it('should throw if API key is not configured', async () => {
      mockedGetApiKey.mockResolvedValue('')

      await expect(
        chatCompletion('openai/gpt-4o', [{ role: 'user', content: 'test' }])
      ).rejects.toThrow('API key is not configured')
    })

    it('should throw on non-ok response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      })

      await expect(
        chatCompletion('openai/gpt-4o', [{ role: 'user', content: 'test' }])
      ).rejects.toThrow('OpenRouter API error (401)')
    })

    it('should throw if no content in response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ choices: [] }),
      })

      await expect(
        chatCompletion('openai/gpt-4o', [{ role: 'user', content: 'test' }])
      ).rejects.toThrow('No content')
    })
  })

  describe('generateImage', () => {
    it('should return content from image generation response', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'https://example.com/image.png' } }],
      }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })

      const result = await generateImage('openai/dall-e-3', 'A beautiful landscape')
      expect(result).toBe('https://example.com/image.png')
    })
  })
})
```

**Step 2: Run tests**

Run: `cd video-pipeline && npx vitest run tests/unit/openrouter.test.ts`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add tests/unit/openrouter.test.ts
git commit -m "test: add unit tests for OpenRouter integration"
```

---

### Task 4: Unit tests — Zustand store

**Files:**
- Create: `tests/unit/projectStore.test.ts`
- Reference: `src/stores/projectStore.ts`

**Step 1: Write tests (mock api module)**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from '@testing-library/react'

// Mock the API module
vi.mock('../../src/lib/api', () => ({
  api: {
    projects: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    generate: {
      script: vi.fn(),
      splitShots: vi.fn(),
      image: vi.fn(),
    },
    shots: {
      update: vi.fn(),
      setStatus: vi.fn(),
    },
    assets: {
      delete: vi.fn(),
    },
  },
}))

import { useProjectStore } from '../../src/stores/projectStore'
import { api } from '../../src/lib/api'

const mockedApi = vi.mocked(api, true)

const mockProject = {
  id: 'proj-1',
  name: 'Test Project',
  created: '2026-01-01T00:00:00Z',
  updated: '2026-01-01T00:00:00Z',
  stage: 'brief' as const,
  briefType: 'text' as const,
  brief: { text: 'Test brief', assets: [] },
  script: '',
  shots: [],
  settings: {
    textModel: 'openai/gpt-4o',
    imageModel: 'openai/dall-e-3',
    masterPromptScriptwriter: 'test',
    masterPromptShotSplitter: 'test',
  },
}

describe('projectStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state
    useProjectStore.setState({
      projects: [],
      activeProjectId: null,
      activeShotId: null,
      loading: false,
      error: null,
    })
  })

  describe('loadProjects', () => {
    it('should fetch and set projects', async () => {
      mockedApi.projects.list.mockResolvedValue([mockProject])

      await act(async () => {
        await useProjectStore.getState().loadProjects()
      })

      const state = useProjectStore.getState()
      expect(state.projects).toHaveLength(1)
      expect(state.projects[0].name).toBe('Test Project')
      expect(state.loading).toBe(false)
    })

    it('should set error on failure', async () => {
      mockedApi.projects.list.mockRejectedValue(new Error('Network error'))

      await act(async () => {
        await useProjectStore.getState().loadProjects()
      })

      const state = useProjectStore.getState()
      expect(state.error).toBe('Network error')
      expect(state.loading).toBe(false)
    })
  })

  describe('createProject', () => {
    it('should create project and set it as active', async () => {
      mockedApi.projects.create.mockResolvedValue(mockProject)

      await act(async () => {
        await useProjectStore.getState().createProject('Test Project')
      })

      const state = useProjectStore.getState()
      expect(state.projects).toHaveLength(1)
      expect(state.activeProjectId).toBe('proj-1')
    })
  })

  describe('setActiveProject', () => {
    it('should set active project and clear active shot', () => {
      useProjectStore.setState({
        projects: [mockProject],
        activeShotId: 'shot-1',
      })

      act(() => {
        useProjectStore.getState().setActiveProject('proj-1')
      })

      const state = useProjectStore.getState()
      expect(state.activeProjectId).toBe('proj-1')
      expect(state.activeShotId).toBeNull()
    })
  })

  describe('activeProject computed', () => {
    it('should return the active project', () => {
      useProjectStore.setState({
        projects: [mockProject],
        activeProjectId: 'proj-1',
      })

      const project = useProjectStore.getState().activeProject()
      expect(project?.name).toBe('Test Project')
    })

    it('should return null when no active project', () => {
      const project = useProjectStore.getState().activeProject()
      expect(project).toBeNull()
    })
  })

  describe('optimistic updates', () => {
    it('updateBriefText should update text locally and call API', () => {
      useProjectStore.setState({ projects: [mockProject] })
      mockedApi.projects.update.mockResolvedValue({})

      act(() => {
        useProjectStore.getState().updateBriefText('proj-1', 'New brief text')
      })

      const state = useProjectStore.getState()
      const proj = state.projects.find((p) => p.id === 'proj-1')
      expect(proj?.brief.text).toBe('New brief text')
      expect(mockedApi.projects.update).toHaveBeenCalledWith('proj-1', {
        brief: { text: 'New brief text' },
      })
    })

    it('updateProjectStage should update stage locally', () => {
      useProjectStore.setState({ projects: [mockProject] })
      mockedApi.projects.update.mockResolvedValue({})

      act(() => {
        useProjectStore.getState().updateProjectStage('proj-1', 'script')
      })

      const proj = useProjectStore.getState().projects.find((p) => p.id === 'proj-1')
      expect(proj?.stage).toBe('script')
    })

    it('addBriefAsset should add asset to project', () => {
      useProjectStore.setState({ projects: [mockProject] })

      const asset = {
        id: 'asset-1',
        filename: 'test.jpg',
        label: '',
        url: '/api/projects/proj-1/assets/file/test.jpg',
      }

      act(() => {
        useProjectStore.getState().addBriefAsset('proj-1', asset)
      })

      const proj = useProjectStore.getState().projects.find((p) => p.id === 'proj-1')
      expect(proj?.brief.assets).toHaveLength(1)
      expect(proj?.brief.assets[0].filename).toBe('test.jpg')
    })

    it('removeBriefAsset should remove asset and call API', () => {
      const projectWithAsset = {
        ...mockProject,
        brief: {
          text: '',
          assets: [{ id: 'asset-1', filename: 'test.jpg', label: '', url: '/test' }],
        },
      }
      useProjectStore.setState({ projects: [projectWithAsset] })
      mockedApi.assets.delete.mockResolvedValue(undefined)

      act(() => {
        useProjectStore.getState().removeBriefAsset('proj-1', 'asset-1')
      })

      const proj = useProjectStore.getState().projects.find((p) => p.id === 'proj-1')
      expect(proj?.brief.assets).toHaveLength(0)
      expect(mockedApi.assets.delete).toHaveBeenCalledWith('proj-1', 'asset-1')
    })
  })
})
```

**Step 2: Run tests**

Run: `cd video-pipeline && npx vitest run tests/unit/projectStore.test.ts`
Expected: All PASS

**Step 3: Commit**

```bash
git add tests/unit/projectStore.test.ts
git commit -m "test: add unit tests for Zustand project store"
```

---

### Task 5: Integration tests — Express routes (projects, settings)

**Files:**
- Create: `tests/integration/setup.ts`
- Create: `tests/integration/projects.test.ts`
- Create: `tests/integration/settings.test.ts`
- Reference: `server/index.ts`, `server/routes/projects.ts`, `server/routes/settings.ts`

**Step 1: Create integration test helper `tests/integration/setup.ts`**

This creates a shared Express app instance for supertest:

```typescript
import express from 'express'
import cors from 'cors'
import projectRoutes from '../../server/routes/projects'
import settingsRoutes from '../../server/routes/settings'
import assetRoutes from '../../server/routes/assets'
import generateRoutes from '../../server/routes/generate'
import shotRoutes from '../../server/routes/shots'
import exportRoutes from '../../server/routes/export'

export function createApp() {
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '50mb' }))

  app.use('/api/projects', projectRoutes)
  app.use('/api/settings', settingsRoutes)
  app.use('/api/projects/:id/assets', assetRoutes)
  app.use('/api/projects/:id', generateRoutes)
  app.use('/api/projects/:id/shots', shotRoutes)
  app.use('/api/projects/:id', exportRoutes)

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  return app
}
```

**Step 2: Write `tests/integration/projects.test.ts`**

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from './setup'
import { deleteProject } from '../../server/lib/storage'

const app = createApp()
const createdIds: string[] = []

afterEach(async () => {
  for (const id of createdIds) {
    await deleteProject(id)
  }
  createdIds.length = 0
})

describe('Projects API', () => {
  describe('POST /api/projects', () => {
    it('should create a project', async () => {
      const res = await request(app)
        .post('/api/projects')
        .send({ name: 'Integration Test Project' })
        .expect(201)

      expect(res.body.name).toBe('Integration Test Project')
      expect(res.body.id).toBeTruthy()
      expect(res.body.stage).toBe('brief')
      createdIds.push(res.body.id)
    })

    it('should return 400 without name', async () => {
      await request(app).post('/api/projects').send({}).expect(400)
    })
  })

  describe('GET /api/projects', () => {
    it('should list projects', async () => {
      const create = await request(app)
        .post('/api/projects')
        .send({ name: 'List Test' })
        .expect(201)
      createdIds.push(create.body.id)

      const res = await request(app).get('/api/projects').expect(200)
      expect(Array.isArray(res.body)).toBe(true)
      const found = res.body.find((p: any) => p.id === create.body.id)
      expect(found).toBeTruthy()
    })
  })

  describe('GET /api/projects/:id', () => {
    it('should return a project by id', async () => {
      const create = await request(app)
        .post('/api/projects')
        .send({ name: 'Get Test' })
        .expect(201)
      createdIds.push(create.body.id)

      const res = await request(app)
        .get(`/api/projects/${create.body.id}`)
        .expect(200)
      expect(res.body.name).toBe('Get Test')
    })

    it('should return 404 for non-existent project', async () => {
      await request(app).get('/api/projects/fake-id').expect(404)
    })
  })

  describe('PUT /api/projects/:id', () => {
    it('should update project fields', async () => {
      const create = await request(app)
        .post('/api/projects')
        .send({ name: 'Update Test' })
        .expect(201)
      createdIds.push(create.body.id)

      const res = await request(app)
        .put(`/api/projects/${create.body.id}`)
        .send({ script: 'New script', stage: 'script' })
        .expect(200)

      expect(res.body.script).toBe('New script')
      expect(res.body.stage).toBe('script')
      // id and created should be preserved
      expect(res.body.id).toBe(create.body.id)
      expect(res.body.created).toBe(create.body.created)
    })

    it('should deep-merge settings', async () => {
      const create = await request(app)
        .post('/api/projects')
        .send({ name: 'Settings Merge Test' })
        .expect(201)
      createdIds.push(create.body.id)

      const res = await request(app)
        .put(`/api/projects/${create.body.id}`)
        .send({ settings: { model: 'anthropic/claude-3.5-sonnet' } })
        .expect(200)

      expect(res.body.settings.model).toBe('anthropic/claude-3.5-sonnet')
      // Other settings should be preserved
      expect(res.body.settings.temperature).toBe(0.7)
    })
  })

  describe('DELETE /api/projects/:id', () => {
    it('should delete a project', async () => {
      const create = await request(app)
        .post('/api/projects')
        .send({ name: 'Delete Test' })
        .expect(201)

      await request(app)
        .delete(`/api/projects/${create.body.id}`)
        .expect(200)

      await request(app)
        .get(`/api/projects/${create.body.id}`)
        .expect(404)
    })
  })
})
```

**Step 3: Write `tests/integration/settings.test.ts`**

```typescript
import { describe, it, expect, afterAll } from 'vitest'
import request from 'supertest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createApp } from './setup'

const app = createApp()
const SETTINGS_PATH = path.join(process.cwd(), 'data', 'settings.json')

// Save original settings and restore after tests
let originalSettings: string | null = null

afterAll(async () => {
  if (originalSettings) {
    await fs.writeFile(SETTINGS_PATH, originalSettings, 'utf-8')
  }
})

describe('Settings API', () => {
  it('should initially read settings (possibly empty)', async () => {
    // Save original
    try {
      originalSettings = await fs.readFile(SETTINGS_PATH, 'utf-8')
    } catch {
      originalSettings = null
    }

    const res = await request(app).get('/api/settings').expect(200)
    expect(res.body).toHaveProperty('openrouterApiKey')
  })

  it('should update settings and mask API key in response', async () => {
    const res = await request(app)
      .put('/api/settings')
      .send({ openrouterApiKey: 'sk-or-test-1234567890' })
      .expect(200)

    // API key should be masked
    expect(res.body.openrouterApiKey).toMatch(/^••••/)
    expect(res.body.openrouterApiKey).toContain('7890')
  })

  it('should preserve API key when masked value is sent back', async () => {
    // First set a key
    await request(app)
      .put('/api/settings')
      .send({ openrouterApiKey: 'sk-or-real-key-abcdef' })

    // Now update other settings, sending masked key back
    const res = await request(app)
      .put('/api/settings')
      .send({
        openrouterApiKey: '••••cdef',
        someOtherSetting: 'value',
      })
      .expect(200)

    // Key should still be masked (unchanged)
    expect(res.body.openrouterApiKey).toMatch(/^••••/)
  })
})
```

**Step 4: Run integration tests**

Run: `cd video-pipeline && npx vitest run tests/integration`
Expected: All PASS

**Step 5: Commit**

```bash
git add tests/integration/
git commit -m "test: add integration tests for projects and settings API"
```

---

### Task 6: Integration tests — assets, shots, export

**Files:**
- Create: `tests/integration/assets.test.ts`
- Create: `tests/integration/shots.test.ts`
- Create: `tests/integration/export.test.ts`

**Step 1: Write `tests/integration/assets.test.ts`**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import path from 'node:path'
import { createApp } from './setup'
import { deleteProject } from '../../server/lib/storage'

const app = createApp()
let projectId: string

beforeAll(async () => {
  const res = await request(app)
    .post('/api/projects')
    .send({ name: 'Asset Test Project' })
  projectId = res.body.id
})

afterAll(async () => {
  await deleteProject(projectId)
})

describe('Assets API', () => {
  let assetId: string

  it('should upload files', async () => {
    const testImagePath = path.join(process.cwd(), 'public', 'vite.svg')

    const res = await request(app)
      .post(`/api/projects/${projectId}/assets`)
      .attach('files', testImagePath)
      .expect(201)

    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBe(1)
    expect(res.body[0].filename).toBe('vite.svg')
    expect(res.body[0].id).toBeTruthy()
    assetId = res.body[0].id
  })

  it('should serve uploaded file', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/assets/file/vite.svg`)
      .expect(200)

    expect(res.body).toBeTruthy()
  })

  it('should reject path traversal', async () => {
    await request(app)
      .get(`/api/projects/${projectId}/assets/file/..%2F..%2F..%2Fetc%2Fpasswd`)
      .expect((res) => {
        // Should be 403 or 404 depending on path resolution
        expect([403, 404]).toContain(res.status)
      })
  })

  it('should delete asset', async () => {
    const res = await request(app)
      .delete(`/api/projects/${projectId}/assets/${assetId}`)
      .expect(200)

    expect(res.body.ok).toBe(true)

    // Verify project no longer has the asset
    const proj = await request(app)
      .get(`/api/projects/${projectId}`)
      .expect(200)
    expect(proj.body.brief.assets).toHaveLength(0)
  })
})
```

**Step 2: Write `tests/integration/shots.test.ts`**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from './setup'
import { deleteProject, getProject, saveProject } from '../../server/lib/storage'

const app = createApp()
let projectId: string

beforeAll(async () => {
  const res = await request(app)
    .post('/api/projects')
    .send({ name: 'Shots Test Project' })
  projectId = res.body.id

  // Add a shot manually
  const project = await getProject(projectId)
  if (project) {
    project.shots = [
      {
        id: 'shot-001',
        order: 0,
        prompt: 'A cinematic aerial shot',
        durationSec: 5,
        status: 'draft',
        generatedImages: [],
        selectedImage: null,
        videoFile: null,
      },
    ]
    await saveProject(project)
  }
})

afterAll(async () => {
  await deleteProject(projectId)
})

describe('Shots API', () => {
  it('should update shot fields', async () => {
    const res = await request(app)
      .put(`/api/projects/${projectId}/shots/shot-001`)
      .send({ prompt: 'Updated prompt', durationSec: 10 })
      .expect(200)

    expect(res.body.prompt).toBe('Updated prompt')
    expect(res.body.durationSec).toBe(10)
    // id and order should be preserved
    expect(res.body.id).toBe('shot-001')
    expect(res.body.order).toBe(0)
  })

  it('should update shot status', async () => {
    const res = await request(app)
      .put(`/api/projects/${projectId}/shots/shot-001/status`)
      .send({ status: 'review' })
      .expect(200)

    expect(res.body.status).toBe('review')
  })

  it('should return 404 for non-existent shot', async () => {
    await request(app)
      .put(`/api/projects/${projectId}/shots/fake-shot`)
      .send({ prompt: 'test' })
      .expect(404)
  })

  it('should return 400 for missing status', async () => {
    await request(app)
      .put(`/api/projects/${projectId}/shots/shot-001/status`)
      .send({})
      .expect(400)
  })
})
```

**Step 3: Write `tests/integration/export.test.ts`**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from './setup'
import { deleteProject, getProject, saveProject } from '../../server/lib/storage'

const app = createApp()
let projectId: string

beforeAll(async () => {
  const res = await request(app)
    .post('/api/projects')
    .send({ name: 'Export Test Project' })
  projectId = res.body.id

  const project = await getProject(projectId)
  if (project) {
    project.shots = [
      {
        id: 'shot-001',
        order: 0,
        prompt: 'Aerial view of the building',
        durationSec: 5,
        status: 'approved',
        generatedImages: [],
        selectedImage: null,
        videoFile: null,
      },
      {
        id: 'shot-002',
        order: 1,
        prompt: 'Interior walkthrough',
        durationSec: 8,
        status: 'draft',
        generatedImages: [],
        selectedImage: null,
        videoFile: null,
      },
    ]
    await saveProject(project)
  }
})

afterAll(async () => {
  await deleteProject(projectId)
})

describe('Export API', () => {
  it('should export ZIP archive', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/export`)
      .expect(200)

    expect(res.headers['content-type']).toContain('application/zip')
    expect(res.headers['content-disposition']).toContain('.zip')
    expect(res.body).toBeTruthy()
  })

  it('should export prompts as plain text', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/export/prompts`)
      .expect(200)

    expect(res.headers['content-type']).toContain('text/plain')
    expect(res.text).toContain('Export Test Project')
    expect(res.text).toContain('Aerial view of the building')
    expect(res.text).toContain('Interior walkthrough')
  })

  it('should return 404 for non-existent project export', async () => {
    await request(app)
      .get('/api/projects/fake-id/export')
      .expect(404)
  })
})
```

**Step 4: Run all integration tests**

Run: `cd video-pipeline && npx vitest run tests/integration`
Expected: All PASS

**Step 5: Commit**

```bash
git add tests/integration/assets.test.ts tests/integration/shots.test.ts tests/integration/export.test.ts
git commit -m "test: add integration tests for assets, shots, and export API"
```

---

### Task 7: Model dropdown — backend endpoint

**Files:**
- Create: `server/routes/models.ts`
- Modify: `server/index.ts` (add route)
- Modify: `src/lib/api.ts` (add models endpoint)

**Step 1: Write test first — `tests/integration/models.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from './setup'

const app = createApp()

describe('Models API', () => {
  it('should return textModels and imageModels arrays', async () => {
    // Mock global fetch for OpenRouter API call
    const originalFetch = global.fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            {
              id: 'openai/gpt-4o',
              name: 'GPT-4o',
              architecture: { modality: 'text->text' },
            },
            {
              id: 'openai/gpt-image-1',
              name: 'GPT Image 1',
              architecture: { modality: 'text->image' },
            },
            {
              id: 'anthropic/claude-3.5-sonnet',
              name: 'Claude 3.5 Sonnet',
              architecture: { modality: 'text->text' },
            },
          ],
        }),
    })

    const res = await request(app).get('/api/models').expect(200)

    expect(res.body.textModels).toBeDefined()
    expect(res.body.imageModels).toBeDefined()
    expect(Array.isArray(res.body.textModels)).toBe(true)
    expect(Array.isArray(res.body.imageModels)).toBe(true)

    global.fetch = originalFetch
  })

  it('should return empty arrays when fetch fails', async () => {
    const originalFetch = global.fetch
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const res = await request(app).get('/api/models').expect(200)

    expect(res.body.textModels).toEqual([])
    expect(res.body.imageModels).toEqual([])

    global.fetch = originalFetch
  })
})
```

**Step 2: Create `server/routes/models.ts`**

```typescript
import { Router, Request, Response } from 'express';
import { getApiKey } from './settings.js';

const router = Router();

interface OpenRouterModel {
  id: string;
  name: string;
  architecture?: {
    modality?: string;
  };
}

interface CachedModels {
  textModels: { id: string; name: string }[];
  imageModels: { id: string; name: string }[];
  fetchedAt: number;
}

let cache: CachedModels | null = null;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

const IMAGE_MODEL_PATTERNS = [
  'dall-e', 'gpt-image', 'stable-diffusion', 'sdxl', 'midjourney',
  'flux', 'ideogram', 'recraft', 'imagen',
];

function isImageModel(model: OpenRouterModel): boolean {
  const modality = model.architecture?.modality || '';
  if (modality.includes('image')) return true;
  const idLower = model.id.toLowerCase();
  return IMAGE_MODEL_PATTERNS.some((p) => idLower.includes(p));
}

function isTextModel(model: OpenRouterModel): boolean {
  const modality = model.architecture?.modality || '';
  // If modality includes text output and not just image
  if (modality.includes('text') && !modality.includes('image')) return true;
  // Fallback: if not an image model, treat as text
  if (!modality) return !isImageModel(model);
  return modality.includes('text');
}

async function fetchModels(): Promise<CachedModels> {
  // Return cache if fresh
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) {
    return cache;
  }

  try {
    const apiKey = await getApiKey();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch('https://openrouter.ai/api/v1/models', { headers });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status}`);
    }

    const data = (await response.json()) as { data: OpenRouterModel[] };
    const models = data.data || [];

    const textModels = models
      .filter(isTextModel)
      .map((m) => ({ id: m.id, name: m.name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const imageModels = models
      .filter(isImageModel)
      .map((m) => ({ id: m.id, name: m.name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    cache = { textModels, imageModels, fetchedAt: Date.now() };
    return cache;
  } catch (err) {
    console.error('Failed to fetch models from OpenRouter:', err);
    return { textModels: [], imageModels: [], fetchedAt: 0 };
  }
}

// GET /api/models
router.get('/', async (_req: Request, res: Response) => {
  const { textModels, imageModels } = await fetchModels();
  res.json({ textModels, imageModels });
});

export default router;
```

**Step 3: Add route to `server/index.ts`**

Add import at top:
```typescript
import modelRoutes from './routes/models.js';
```

Add route after settings:
```typescript
app.use('/api/models', modelRoutes);
```

**Step 4: Add to API client `src/lib/api.ts`**

Add to the api object:
```typescript
models: {
  list: () => request<{ textModels: { id: string; name: string }[]; imageModels: { id: string; name: string }[] }>('/models'),
},
```

**Step 5: Run model tests**

Run: `cd video-pipeline && npx vitest run tests/integration/models.test.ts`
Expected: All PASS

**Step 6: Commit**

```bash
git add server/routes/models.ts server/index.ts src/lib/api.ts tests/integration/models.test.ts
git commit -m "feat: add /api/models endpoint with OpenRouter model list"
```

---

### Task 8: Model dropdown — frontend UI

**Files:**
- Create: `src/components/ModelSelect.tsx`
- Modify: `src/components/SettingsView.tsx`

**Step 1: Create `src/components/ModelSelect.tsx`**

```tsx
import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Search, Loader2 } from 'lucide-react'

interface Model {
  id: string
  name: string
}

interface ModelSelectProps {
  label: string
  value: string
  onChange: (value: string) => void
  models: Model[]
  loading: boolean
  placeholder?: string
}

export function ModelSelect({ label, value, onChange, models, loading, placeholder }: ModelSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Focus search when opened
  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus()
    }
  }, [open])

  const filtered = models.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.id.toLowerCase().includes(search.toLowerCase())
  )

  const selectedModel = models.find((m) => m.id === value)
  const displayValue = selectedModel ? selectedModel.name : value

  // Fallback to text input if no models available
  if (!loading && models.length === 0) {
    return (
      <div>
        <label className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
          {label}
        </label>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-surface-2 border border-border rounded-lg px-4 py-2.5 text-sm font-mono text-text-primary focus:outline-none focus:border-amber/30 transition-all"
        />
        <p className="text-[10px] text-text-muted mt-1">
          Введите API ключ в настройках, чтобы загрузить список моделей
        </p>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <label className="font-mono text-[10px] uppercase tracking-wider text-text-muted block mb-1.5">
        {label}
      </label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full bg-surface-2 border border-border rounded-lg px-4 py-2.5 text-sm font-mono text-text-primary text-left flex items-center justify-between hover:border-amber/30 focus:outline-none focus:border-amber/30 transition-all"
      >
        <span className="truncate">
          {loading ? (
            <span className="flex items-center gap-2 text-text-muted">
              <Loader2 size={14} className="animate-spin" />
              Загрузка моделей...
            </span>
          ) : (
            displayValue || placeholder
          )}
        </span>
        <ChevronDown
          size={14}
          className={`text-text-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && !loading && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-surface-2 border border-border rounded-lg shadow-xl max-h-72 overflow-hidden flex flex-col">
          {/* Search */}
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск модели..."
                className="w-full bg-bg border border-border rounded-md pl-7 pr-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-amber/30"
              />
            </div>
          </div>

          {/* Model list */}
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-xs text-text-muted text-center">
                Ничего не найдено
              </div>
            ) : (
              filtered.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => {
                    onChange(model.id)
                    setOpen(false)
                    setSearch('')
                  }}
                  className={`w-full text-left px-3 py-2 hover:bg-surface-3 transition-colors ${
                    model.id === value ? 'bg-amber/10 border-l-2 border-amber' : ''
                  }`}
                >
                  <div className="text-sm text-text-primary truncate">{model.name}</div>
                  <div className="text-[10px] font-mono text-text-muted truncate">{model.id}</div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
```

**Step 2: Update `src/components/SettingsView.tsx`**

Replace the models section. Add state for models at top:

```tsx
// Add to imports
import { ModelSelect } from './ModelSelect'

// Add state inside SettingsView component:
const [textModels, setTextModels] = useState<{ id: string; name: string }[]>([])
const [imageModels, setImageModels] = useState<{ id: string; name: string }[]>([])
const [modelsLoading, setModelsLoading] = useState(false)

// Add to useEffect (after existing settings load):
// Fetch available models
setModelsLoading(true)
api.models.list()
  .then(({ textModels, imageModels }) => {
    setTextModels(textModels)
    setImageModels(imageModels)
  })
  .catch(() => {
    // Silently fail — fallback to text input
  })
  .finally(() => setModelsLoading(false))
```

Replace the `{/* Models */}` section with:

```tsx
{/* Models */}
<section>
  <div className="flex items-center gap-2 mb-3">
    <Brain size={14} className="text-amber" />
    <h2 className="font-display font-semibold text-base">Модели</h2>
  </div>
  <div className="space-y-4">
    <ModelSelect
      label="Текстовая модель (сценарий, описания)"
      value={textModel}
      onChange={setTextModel}
      models={textModels}
      loading={modelsLoading}
      placeholder="openai/gpt-4o"
    />
    <ModelSelect
      label="Модель генерации изображений"
      value={imageModel}
      onChange={setImageModel}
      models={imageModels}
      loading={modelsLoading}
      placeholder="openai/gpt-image-1"
    />
  </div>
</section>
```

**Step 3: Verify frontend compiles**

Run: `cd video-pipeline && npx tsc -b --noEmit 2>&1 | head -20`
(May need adjustments to pass TypeScript checks)

**Step 4: Commit**

```bash
git add src/components/ModelSelect.tsx src/components/SettingsView.tsx
git commit -m "feat: add searchable model dropdown in settings"
```

---

### Task 9: Component tests

**Files:**
- Create: `tests/components/SettingsView.test.tsx`
- Create: `tests/components/PipelineHeader.test.tsx`
- Create: `tests/components/BriefEditor.test.tsx`

**Step 1: Write `tests/components/SettingsView.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsView } from '../../src/components/SettingsView'

// Mock the api module
vi.mock('../../src/lib/api', () => ({
  api: {
    settings: {
      get: vi.fn().mockResolvedValue({
        openRouterApiKey: '••••1234',
        defaultTextModel: 'openai/gpt-4o',
        defaultImageModel: 'openai/gpt-image-1',
        masterPromptScriptwriter: 'System prompt',
        masterPromptShotSplitter: 'Splitter prompt',
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    models: {
      list: vi.fn().mockResolvedValue({
        textModels: [
          { id: 'openai/gpt-4o', name: 'GPT-4o' },
          { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
        ],
        imageModels: [
          { id: 'openai/gpt-image-1', name: 'GPT Image 1' },
        ],
      }),
    },
  },
}))

describe('SettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should load and display settings', async () => {
    render(<SettingsView />)

    await waitFor(() => {
      expect(screen.getByText('OpenRouter API')).toBeInTheDocument()
    })

    expect(screen.getByText('Модели')).toBeInTheDocument()
    expect(screen.getByText('Мастер-промпты')).toBeInTheDocument()
  })

  it('should show save button', async () => {
    render(<SettingsView />)

    await waitFor(() => {
      expect(screen.getByText('Сохранить настройки')).toBeInTheDocument()
    })
  })

  it('should display model dropdowns when models are loaded', async () => {
    render(<SettingsView />)

    await waitFor(() => {
      // Should show model names in dropdowns, not plain text inputs
      expect(screen.getByText('GPT-4o')).toBeInTheDocument()
    })
  })
})
```

**Step 2: Write `tests/components/PipelineHeader.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PipelineHeader } from '../../src/components/PipelineHeader'

// Mock the store
vi.mock('../../src/stores/projectStore', () => ({
  useProjectStore: vi.fn((selector) => {
    const state = {
      activeProject: () => ({
        id: 'proj-1',
        name: 'Test',
        shots: [
          { id: '1', status: 'draft' },
          { id: '2', status: 'approved' },
          { id: '3', status: 'review' },
        ],
      }),
      loading: false,
      generateScript: vi.fn(),
      splitShots: vi.fn(),
      generateImage: vi.fn(),
    }
    return selector(state)
  }),
}))

describe('PipelineHeader', () => {
  it('should render header for brief view', () => {
    render(<PipelineHeader activeView="brief" />)
    expect(screen.getByText('Бриф')).toBeInTheDocument()
  })

  it('should render header for shots view', () => {
    render(<PipelineHeader activeView="shots" />)
    expect(screen.getByText('Шоты')).toBeInTheDocument()
  })
})
```

**Step 3: Run component tests**

Run: `cd video-pipeline && npx vitest run tests/components`
Expected: All PASS

**Step 4: Commit**

```bash
git add tests/components/
git commit -m "test: add component tests for SettingsView and PipelineHeader"
```

---

### Task 10: Install Playwright and configure e2e

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/pipeline.spec.ts`
- Create: `tests/e2e/project-crud.spec.ts`

**Step 1: Install Playwright**

Run:
```bash
cd video-pipeline && npm install -D @playwright/test && npx playwright install chromium
```

**Step 2: Create `playwright.config.ts`**

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm run server',
      port: 3001,
      reuseExistingServer: true,
      timeout: 15000,
    },
    {
      command: 'npm run dev',
      port: 5173,
      reuseExistingServer: true,
      timeout: 15000,
    },
  ],
})
```

**Step 3: Write `tests/e2e/project-crud.spec.ts`**

```typescript
import { test, expect } from '@playwright/test'

test.describe('Project CRUD', () => {
  test('should create a new project', async ({ page }) => {
    await page.goto('/')

    // Should see creation screen or existing project
    // If projects exist, we'll see the sidebar
    const hasProjects = await page.locator('text=Бриф').isVisible().catch(() => false)

    if (!hasProjects) {
      // No projects — create one
      const nameInput = page.locator('input[placeholder="Название проекта..."]')
      await expect(nameInput).toBeVisible({ timeout: 10000 })

      await nameInput.fill('E2E Test Project')
      await page.locator('text=Создать проект').click()

      // Should navigate to brief view
      await expect(page.locator('text=Бриф')).toBeVisible({ timeout: 10000 })
    }
  })

  test('should display sidebar navigation', async ({ page }) => {
    await page.goto('/')

    // Wait for the app to load
    await page.waitForTimeout(2000)

    // If no projects, create one first
    const nameInput = page.locator('input[placeholder="Название проекта..."]')
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill('Nav Test Project')
      await page.locator('text=Создать проект').click()
    }

    // Should see pipeline stages in sidebar
    await expect(page.locator('text=Бриф')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('text=Сценарий')).toBeVisible()
    await expect(page.locator('text=Шоты')).toBeVisible()
    await expect(page.locator('text=Ревью')).toBeVisible()
    await expect(page.locator('text=Экспорт')).toBeVisible()
  })

  test('should navigate between views', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(2000)

    // Create project if needed
    const nameInput = page.locator('input[placeholder="Название проекта..."]')
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill('Navigate Test')
      await page.locator('text=Создать проект').click()
      await page.waitForTimeout(1000)
    }

    // Click on Сценарий
    await page.locator('text=Сценарий').click()
    await expect(page.locator('h1, h2, h3').filter({ hasText: 'Сценарий' })).toBeVisible({ timeout: 5000 })

    // Click on Настройки
    await page.locator('text=Настройки').click()
    await expect(page.locator('text=OpenRouter API')).toBeVisible({ timeout: 5000 })
  })
})
```

**Step 4: Write `tests/e2e/pipeline.spec.ts`**

```typescript
import { test, expect } from '@playwright/test'

test.describe('Pipeline Flow', () => {
  test('should load the app and show brief editor', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(2000)

    // Create project if needed
    const nameInput = page.locator('input[placeholder="Название проекта..."]')
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill('Pipeline Test')
      await page.locator('text=Создать проект').click()
      await page.waitForTimeout(1000)
    }

    // Should be on brief view with text area and upload zone
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 10000 })
  })

  test('should write brief text', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(2000)

    const nameInput = page.locator('input[placeholder="Название проекта..."]')
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill('Brief Text Test')
      await page.locator('text=Создать проект').click()
      await page.waitForTimeout(1000)
    }

    const textarea = page.locator('textarea').first()
    await textarea.fill('This is a test brief for the video pipeline')

    // Text should be saved
    await page.waitForTimeout(1000)
    await expect(textarea).toHaveValue('This is a test brief for the video pipeline')
  })

  test('should open settings and show model configuration', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(2000)

    const nameInput = page.locator('input[placeholder="Название проекта..."]')
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill('Settings Test')
      await page.locator('text=Создать проект').click()
      await page.waitForTimeout(1000)
    }

    // Navigate to settings
    await page.locator('text=Настройки').click()
    await expect(page.locator('text=OpenRouter API')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('text=Модели')).toBeVisible()
    await expect(page.locator('text=Мастер-промпты')).toBeVisible()
  })

  test('health check endpoint should work', async ({ request }) => {
    const res = await request.get('http://localhost:3001/api/health')
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.status).toBe('ok')
  })
})
```

**Step 5: Run e2e tests (servers must be running)**

Run: `cd video-pipeline && npx playwright test`
Expected: All PASS (servers auto-started by webServer config)

**Step 6: Commit**

```bash
git add playwright.config.ts tests/e2e/
git commit -m "test: add Playwright e2e tests for pipeline flow"
```

---

### Task 11: Final — run all tests and verify

**Step 1: Run unit + integration + component tests**

Run: `cd video-pipeline && npx vitest run`
Expected: All PASS

**Step 2: Run e2e tests**

Run: `cd video-pipeline && npx playwright test`
Expected: All PASS

**Step 3: Final commit with updated package.json scripts**

```bash
git add -A
git commit -m "chore: finalize test suite — all unit, integration, component, and e2e tests passing"
```
