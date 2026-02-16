# CutRoom Video Pipeline — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Connect the existing React UI to a real Express backend with file storage, OpenRouter AI integration, file uploads, and ZIP export.

**Architecture:** Monorepo with `server/` (Express + TypeScript) and `src/` (existing Vite React frontend). Backend serves API at `/api/*`, frontend dev server proxies to it. Projects stored as folder trees on disk. All LLM calls proxied through backend to protect API keys.

**Tech Stack:** Express, multer (file uploads), archiver (ZIP), uuid, OpenRouter API (OpenAI-compatible chat completions format)

---

## Task 1: Backend scaffold + project CRUD

**Files:**
- Create: `server/index.ts`
- Create: `server/routes/projects.ts`
- Create: `server/lib/storage.ts`
- Create: `server/tsconfig.json`
- Modify: `package.json` (add server deps + scripts)
- Modify: `vite.config.ts` (add proxy)

**Step 1: Install backend dependencies**

```bash
cd video-pipeline
npm install express cors uuid
npm install -D @types/express @types/cors @types/uuid tsx
```

**Step 2: Create `server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "./dist",
    "rootDir": ".",
    "resolveJsonModule": true,
    "declaration": false,
    "skipLibCheck": true
  },
  "include": ["./**/*.ts"]
}
```

**Step 3: Create `server/lib/storage.ts`**

File-system storage layer. All project data lives under `data/projects/`. Functions:

```typescript
import fs from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'

const DATA_DIR = path.resolve(process.cwd(), 'data', 'projects')

export async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true })
}

export async function listProjects(): Promise<any[]> {
  await ensureDir(DATA_DIR)
  const entries = await fs.readdir(DATA_DIR, { withFileTypes: true })
  const projects = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const projectPath = path.join(DATA_DIR, entry.name, 'project.json')
    try {
      const data = JSON.parse(await fs.readFile(projectPath, 'utf-8'))
      projects.push(data)
    } catch { /* skip broken projects */ }
  }
  return projects.sort((a, b) => b.updated.localeCompare(a.updated))
}

export async function getProject(id: string): Promise<any | null> {
  const projectPath = path.join(DATA_DIR, id, 'project.json')
  try {
    return JSON.parse(await fs.readFile(projectPath, 'utf-8'))
  } catch { return null }
}

export async function createProject(name: string): Promise<any> {
  const id = randomUUID()
  const now = new Date().toISOString()
  const project = {
    id, name, created: now, updated: now,
    stage: 'brief', briefType: 'text',
    brief: { text: '', assets: [] },
    script: '',
    shots: [],
    settings: {
      textModel: 'openai/gpt-4o',
      imageModel: 'openai/gpt-image-1',
      masterPromptScriptwriter: 'Ты опытный сценарист рекламных роликов. Пиши кинематографично, описывай движения камеры. При наличии изображений — ссылайся на них по имени файла.',
      masterPromptShotSplitter: 'Раздели сценарий на отдельные шоты. Каждый шот = один непрерывный кадр. Укажи файлы изображений через "Используем: filename". Верни JSON-массив шотов.',
    },
  }
  const dir = path.join(DATA_DIR, id)
  await ensureDir(dir)
  await ensureDir(path.join(dir, 'brief', 'images'))
  await ensureDir(path.join(dir, 'shots'))
  await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify(project, null, 2))
  return project
}

export async function saveProject(project: any): Promise<void> {
  project.updated = new Date().toISOString()
  const dir = path.join(DATA_DIR, project.id)
  await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify(project, null, 2))
}

export async function deleteProject(id: string): Promise<void> {
  await fs.rm(path.join(DATA_DIR, id), { recursive: true, force: true })
}

export function getProjectDir(id: string): string {
  return path.join(DATA_DIR, id)
}
```

**Step 4: Create `server/routes/projects.ts`**

```typescript
import { Router } from 'express'
import * as storage from '../lib/storage.js'

const router = Router()

router.get('/', async (_req, res) => {
  const projects = await storage.listProjects()
  res.json(projects)
})

router.post('/', async (req, res) => {
  const { name } = req.body
  if (!name) return res.status(400).json({ error: 'name required' })
  const project = await storage.createProject(name)
  res.status(201).json(project)
})

router.get('/:id', async (req, res) => {
  const project = await storage.getProject(req.params.id)
  if (!project) return res.status(404).json({ error: 'not found' })
  res.json(project)
})

router.put('/:id', async (req, res) => {
  const existing = await storage.getProject(req.params.id)
  if (!existing) return res.status(404).json({ error: 'not found' })
  const updated = { ...existing, ...req.body, id: existing.id, created: existing.created }
  await storage.saveProject(updated)
  res.json(updated)
})

router.delete('/:id', async (req, res) => {
  await storage.deleteProject(req.params.id)
  res.status(204).end()
})

export default router
```

**Step 5: Create `server/index.ts`**

```typescript
import express from 'express'
import cors from 'cors'
import projectRoutes from './routes/projects.js'

const app = express()
const PORT = parseInt(process.env.PORT || '3001')

app.use(cors())
app.use(express.json({ limit: '50mb' }))

app.use('/api/projects', projectRoutes)

app.listen(PORT, () => {
  console.log(`CutRoom API running on http://localhost:${PORT}`)
})
```

**Step 6: Add scripts to `package.json`**

Add to `scripts`:
```json
"server": "tsx watch server/index.ts",
"dev:all": "concurrently \"npm run server\" \"npm run dev\""
```

Install concurrently: `npm install -D concurrently`

**Step 7: Add Vite proxy in `vite.config.ts`**

```typescript
server: {
  proxy: {
    '/api': 'http://localhost:3001'
  }
}
```

**Step 8: Test manually**

```bash
npm run server
# In another terminal:
curl -X POST http://localhost:3001/api/projects -H "Content-Type: application/json" -d '{"name":"Test"}'
curl http://localhost:3001/api/projects
```

**Step 9: Commit**

```bash
git add server/ package.json vite.config.ts
git commit -m "feat: add Express backend with project CRUD and file storage"
```

---

## Task 2: Settings API + app settings storage

**Files:**
- Create: `server/routes/settings.ts`
- Modify: `server/index.ts` (mount settings route)

**Step 1: Create `server/routes/settings.ts`**

Stores global settings in `data/settings.json`.

```typescript
import { Router } from 'express'
import fs from 'fs/promises'
import path from 'path'

const router = Router()
const SETTINGS_PATH = path.resolve(process.cwd(), 'data', 'settings.json')

async function getSettings() {
  try {
    return JSON.parse(await fs.readFile(SETTINGS_PATH, 'utf-8'))
  } catch {
    return { openRouterApiKey: '', defaultTextModel: 'openai/gpt-4o', defaultImageModel: 'openai/gpt-image-1' }
  }
}

async function saveSettings(settings: any) {
  await fs.mkdir(path.dirname(SETTINGS_PATH), { recursive: true })
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2))
}

router.get('/', async (_req, res) => {
  const settings = await getSettings()
  // Mask API key in response
  res.json({ ...settings, openRouterApiKey: settings.openRouterApiKey ? '••••' + settings.openRouterApiKey.slice(-4) : '' })
})

router.put('/', async (req, res) => {
  const current = await getSettings()
  const updated = { ...current, ...req.body }
  // If masked key sent back, keep existing
  if (updated.openRouterApiKey?.startsWith('••••')) {
    updated.openRouterApiKey = current.openRouterApiKey
  }
  await saveSettings(updated)
  res.json({ ...updated, openRouterApiKey: updated.openRouterApiKey ? '••••' + updated.openRouterApiKey.slice(-4) : '' })
})

// Internal: get raw key (not exposed to frontend)
export async function getApiKey(): Promise<string> {
  const settings = await getSettings()
  return settings.openRouterApiKey || ''
}

export default router
```

**Step 2: Mount in `server/index.ts`**

```typescript
import settingsRoutes from './routes/settings.js'
app.use('/api/settings', settingsRoutes)
```

**Step 3: Commit**

```bash
git add server/routes/settings.ts server/index.ts
git commit -m "feat: add settings API with masked API key"
```

---

## Task 3: File upload (brief assets)

**Files:**
- Create: `server/routes/assets.ts`
- Modify: `server/index.ts` (mount + static serving)

**Step 1: Install multer**

```bash
npm install multer
npm install -D @types/multer
```

**Step 2: Create `server/routes/assets.ts`**

```typescript
import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs/promises'
import { randomUUID } from 'crypto'
import * as storage from '../lib/storage.js'

const router = Router({ mergeParams: true })

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, _file, cb) => {
      const dir = path.join(storage.getProjectDir(req.params.id), 'brief', 'images')
      await fs.mkdir(dir, { recursive: true })
      cb(null, dir)
    },
    filename: (_req, file, cb) => {
      // Keep original filename
      cb(null, file.originalname)
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB per file
})

// Upload one or more files
router.post('/', upload.array('files', 50), async (req, res) => {
  const project = await storage.getProject(req.params.id)
  if (!project) return res.status(404).json({ error: 'project not found' })

  const files = req.files as Express.Multer.File[]
  const newAssets = files.map((f) => ({
    id: randomUUID(),
    filename: f.originalname,
    label: '',
    url: `/api/projects/${req.params.id}/assets/file/${f.originalname}`,
  }))

  project.brief.assets.push(...newAssets)
  if (project.briefType === 'text' && newAssets.length > 0) {
    project.briefType = 'mixed'
  }
  await storage.saveProject(project)
  res.status(201).json(newAssets)
})

// Serve asset file
router.get('/file/:filename', async (req, res) => {
  const filePath = path.join(
    storage.getProjectDir(req.params.id), 'brief', 'images', req.params.filename
  )
  try {
    await fs.access(filePath)
    res.sendFile(filePath)
  } catch {
    res.status(404).json({ error: 'file not found' })
  }
})

// Delete asset
router.delete('/:assetId', async (req, res) => {
  const project = await storage.getProject(req.params.id)
  if (!project) return res.status(404).json({ error: 'project not found' })

  const asset = project.brief.assets.find((a: any) => a.id === req.params.assetId)
  if (!asset) return res.status(404).json({ error: 'asset not found' })

  // Remove file
  const filePath = path.join(storage.getProjectDir(req.params.id), 'brief', 'images', asset.filename)
  try { await fs.unlink(filePath) } catch { /* file may not exist */ }

  // Remove from project
  project.brief.assets = project.brief.assets.filter((a: any) => a.id !== req.params.assetId)
  await storage.saveProject(project)
  res.status(204).end()
})

export default router
```

**Step 3: Mount in `server/index.ts`**

```typescript
import assetRoutes from './routes/assets.js'
app.use('/api/projects/:id/assets', assetRoutes)
```

**Step 4: Commit**

```bash
git add server/routes/assets.ts package.json
git commit -m "feat: add file upload/download/delete for brief assets"
```

---

## Task 4: OpenRouter integration (script generation + shot splitting)

**Files:**
- Create: `server/lib/openrouter.ts`
- Create: `server/routes/generate.ts`
- Modify: `server/index.ts` (mount)

**Step 1: Create `server/lib/openrouter.ts`**

```typescript
import { getApiKey } from '../routes/settings.js'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export async function chatCompletion(model: string, messages: ChatMessage[]): Promise<string> {
  const apiKey = await getApiKey()
  if (!apiKey) throw new Error('OpenRouter API key not configured')

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:5173',
      'X-Title': 'CutRoom Video Pipeline',
    },
    body: JSON.stringify({ model, messages }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`OpenRouter error ${response.status}: ${err}`)
  }

  const data = await response.json()
  return data.choices[0]?.message?.content ?? ''
}

export async function generateImage(model: string, prompt: string): Promise<string> {
  const apiKey = await getApiKey()
  if (!apiKey) throw new Error('OpenRouter API key not configured')

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:5173',
      'X-Title': 'CutRoom Video Pipeline',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`OpenRouter error ${response.status}: ${err}`)
  }

  const data = await response.json()
  // Image models return base64 in content or url — handle both
  const content = data.choices[0]?.message?.content ?? ''
  return content
}
```

**Step 2: Create `server/routes/generate.ts`**

```typescript
import { Router } from 'express'
import * as storage from '../lib/storage.js'
import { chatCompletion, generateImage } from '../lib/openrouter.js'
import fs from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'

const router = Router({ mergeParams: true })

// Generate script from brief
router.post('/generate-script', async (req, res) => {
  try {
    const project = await storage.getProject(req.params.id)
    if (!project) return res.status(404).json({ error: 'project not found' })

    const assetList = project.brief.assets
      .map((a: any) => `- ${a.filename}${a.label ? ` — ${a.label}` : ''}`)
      .join('\n')

    const userContent = [
      project.brief.text,
      assetList ? `\nДоступные изображения:\n${assetList}\n\nПри составлении сценария ссылайся на конкретные файлы по имени через "Используем: filename".` : '',
    ].join('\n')

    const script = await chatCompletion(project.settings.textModel, [
      { role: 'system', content: project.settings.masterPromptScriptwriter },
      { role: 'user', content: userContent },
    ])

    project.script = script
    project.stage = 'script'
    await storage.saveProject(project)
    res.json({ script })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Split script into shots
router.post('/split-shots', async (req, res) => {
  try {
    const project = await storage.getProject(req.params.id)
    if (!project) return res.status(404).json({ error: 'project not found' })
    if (!project.script) return res.status(400).json({ error: 'no script to split' })

    const userContent = `Сценарий:\n\n${project.script}\n\nДоступные файлы:\n${project.brief.assets.map((a: any) => a.filename).join(', ')}\n\nВерни JSON-массив объектов с полями: scene, audioDescription, imagePrompt, videoPrompt, duration (секунды), assetRefs (массив имён файлов). Только JSON, без маркдауна.`

    const response = await chatCompletion(project.settings.textModel, [
      { role: 'system', content: project.settings.masterPromptShotSplitter },
      { role: 'user', content: userContent },
    ])

    // Parse JSON from response (strip markdown code fences if present)
    const jsonStr = response.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(jsonStr)

    const shots = parsed.map((s: any, i: number) => ({
      id: `shot-${String(i + 1).padStart(3, '0')}`,
      order: i + 1,
      status: 'draft',
      scene: s.scene || '',
      audioDescription: s.audioDescription || '',
      imagePrompt: s.imagePrompt || '',
      videoPrompt: s.videoPrompt || '',
      duration: s.duration || 5,
      assetRefs: s.assetRefs || [],
      generatedImages: [],
      videoFile: null,
    }))

    // Create shot directories
    for (const shot of shots) {
      const shotDir = path.join(storage.getProjectDir(project.id), 'shots', shot.id)
      await fs.mkdir(path.join(shotDir, 'reference'), { recursive: true })
      await fs.mkdir(path.join(shotDir, 'generated'), { recursive: true })
      await fs.mkdir(path.join(shotDir, 'video'), { recursive: true })
    }

    project.shots = shots
    project.stage = 'shots'
    await storage.saveProject(project)
    res.json({ shots })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Generate image for a shot
router.post('/shots/:shotId/generate-image', async (req, res) => {
  try {
    const project = await storage.getProject(req.params.id)
    if (!project) return res.status(404).json({ error: 'project not found' })

    const shot = project.shots.find((s: any) => s.id === req.params.shotId)
    if (!shot) return res.status(404).json({ error: 'shot not found' })

    shot.status = 'generating'
    await storage.saveProject(project)

    const content = await generateImage(project.settings.imageModel, shot.imagePrompt)

    // If content is base64, save as file
    const filename = `gen-${Date.now()}.png`
    const genDir = path.join(storage.getProjectDir(project.id), 'shots', shot.id, 'generated')
    await fs.mkdir(genDir, { recursive: true })

    if (content.startsWith('data:image') || content.match(/^[A-Za-z0-9+/=]+$/)) {
      const base64Data = content.replace(/^data:image\/\w+;base64,/, '')
      await fs.writeFile(path.join(genDir, filename), Buffer.from(base64Data, 'base64'))
    } else {
      // Content might be a URL — fetch and save
      try {
        const imgResponse = await fetch(content)
        const buffer = Buffer.from(await imgResponse.arrayBuffer())
        await fs.writeFile(path.join(genDir, filename), buffer)
      } catch {
        await fs.writeFile(path.join(genDir, filename + '.txt'), content)
      }
    }

    shot.generatedImages.push(filename)
    shot.status = 'review'
    await storage.saveProject(project)

    res.json({ filename, shot })
  } catch (err: any) {
    // Revert status on error
    const project = await storage.getProject(req.params.id)
    if (project) {
      const shot = project.shots.find((s: any) => s.id === req.params.shotId)
      if (shot) { shot.status = 'draft'; await storage.saveProject(project) }
    }
    res.status(500).json({ error: err.message })
  }
})

// Serve generated image
router.get('/shots/:shotId/generated/:filename', async (req, res) => {
  const filePath = path.join(
    storage.getProjectDir(req.params.id), 'shots', req.params.shotId, 'generated', req.params.filename
  )
  try {
    await fs.access(filePath)
    res.sendFile(filePath)
  } catch {
    res.status(404).json({ error: 'file not found' })
  }
})

export default router
```

**Step 3: Mount in `server/index.ts`**

```typescript
import generateRoutes from './routes/generate.js'
app.use('/api/projects/:id', generateRoutes)
```

**Step 4: Commit**

```bash
git add server/lib/openrouter.ts server/routes/generate.ts server/index.ts
git commit -m "feat: add OpenRouter integration for script/shot/image generation"
```

---

## Task 5: Shot update + video upload

**Files:**
- Create: `server/routes/shots.ts`
- Modify: `server/index.ts` (mount)

**Step 1: Create `server/routes/shots.ts`**

```typescript
import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs/promises'
import * as storage from '../lib/storage.js'

const router = Router({ mergeParams: true })

// Update shot fields
router.put('/:shotId', async (req, res) => {
  const project = await storage.getProject(req.params.id)
  if (!project) return res.status(404).json({ error: 'project not found' })

  const idx = project.shots.findIndex((s: any) => s.id === req.params.shotId)
  if (idx === -1) return res.status(404).json({ error: 'shot not found' })

  const { id, order, ...allowed } = req.body
  project.shots[idx] = { ...project.shots[idx], ...allowed }
  await storage.saveProject(project)
  res.json(project.shots[idx])
})

// Change shot status
router.put('/:shotId/status', async (req, res) => {
  const project = await storage.getProject(req.params.id)
  if (!project) return res.status(404).json({ error: 'project not found' })

  const shot = project.shots.find((s: any) => s.id === req.params.shotId)
  if (!shot) return res.status(404).json({ error: 'shot not found' })

  shot.status = req.body.status
  await storage.saveProject(project)
  res.json(shot)
})

// Upload video file
const videoUpload = multer({
  storage: multer.diskStorage({
    destination: async (req, _file, cb) => {
      const dir = path.join(
        storage.getProjectDir(req.params.id), 'shots', req.params.shotId, 'video'
      )
      await fs.mkdir(dir, { recursive: true })
      cb(null, dir)
    },
    filename: (_req, file, cb) => cb(null, file.originalname),
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
})

router.post('/:shotId/video', videoUpload.single('video'), async (req, res) => {
  const project = await storage.getProject(req.params.id)
  if (!project) return res.status(404).json({ error: 'project not found' })

  const shot = project.shots.find((s: any) => s.id === req.params.shotId)
  if (!shot) return res.status(404).json({ error: 'shot not found' })

  const file = req.file as Express.Multer.File
  shot.videoFile = file.originalname
  await storage.saveProject(project)
  res.json(shot)
})

// Serve video file
router.get('/:shotId/video/:filename', async (req, res) => {
  const filePath = path.join(
    storage.getProjectDir(req.params.id), 'shots', req.params.shotId, 'video', req.params.filename
  )
  try {
    await fs.access(filePath)
    res.sendFile(filePath)
  } catch {
    res.status(404).json({ error: 'file not found' })
  }
})

export default router
```

**Step 2: Mount in `server/index.ts`**

```typescript
import shotRoutes from './routes/shots.js'
app.use('/api/projects/:id/shots', shotRoutes)
```

**Step 3: Commit**

```bash
git add server/routes/shots.ts server/index.ts
git commit -m "feat: add shot update and video upload endpoints"
```

---

## Task 6: ZIP export

**Files:**
- Create: `server/routes/export.ts`
- Modify: `server/index.ts` (mount)

**Step 1: Install archiver**

```bash
npm install archiver
npm install -D @types/archiver
```

**Step 2: Create `server/routes/export.ts`**

```typescript
import { Router } from 'express'
import archiver from 'archiver'
import path from 'path'
import fs from 'fs/promises'
import * as storage from '../lib/storage.js'

const router = Router({ mergeParams: true })

// Export full ZIP
router.get('/export', async (req, res) => {
  const project = await storage.getProject(req.params.id)
  if (!project) return res.status(404).json({ error: 'project not found' })

  const projectDir = storage.getProjectDir(project.id)

  res.set({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${project.name.replace(/[^a-zA-Zа-яА-Я0-9_-]/g, '_')}_export.zip"`,
  })

  const archive = archiver('zip', { zlib: { level: 5 } })
  archive.pipe(res)

  // Add metadata
  archive.append(JSON.stringify(project, null, 2), { name: 'metadata.json' })

  // Add shots
  for (const shot of project.shots) {
    const shotDir = path.join(projectDir, 'shots', shot.id)
    const prefix = `${String(shot.order).padStart(2, '0')}_${shot.id}`

    // Prompts as text file
    const promptText = [
      `Scene: ${shot.scene}`,
      `Audio: ${shot.audioDescription}`,
      `Image Prompt: ${shot.imagePrompt}`,
      `Video Prompt: ${shot.videoPrompt}`,
      `Duration: ${shot.duration}s`,
      `Asset Refs: ${shot.assetRefs.join(', ')}`,
    ].join('\n\n')
    archive.append(promptText, { name: `${prefix}/prompts.txt` })

    // Generated images
    try {
      const genDir = path.join(shotDir, 'generated')
      const files = await fs.readdir(genDir)
      for (const file of files) {
        archive.file(path.join(genDir, file), { name: `${prefix}/images/${file}` })
      }
    } catch { /* no generated images */ }

    // Video files
    try {
      const vidDir = path.join(shotDir, 'video')
      const files = await fs.readdir(vidDir)
      for (const file of files) {
        archive.file(path.join(vidDir, file), { name: `${prefix}/video/${file}` })
      }
    } catch { /* no video */ }

    // Reference images
    try {
      const refDir = path.join(shotDir, 'reference')
      const files = await fs.readdir(refDir)
      for (const file of files) {
        archive.file(path.join(refDir, file), { name: `${prefix}/reference/${file}` })
      }
    } catch { /* no references */ }
  }

  await archive.finalize()
})

// Export prompts only
router.get('/export/prompts', async (req, res) => {
  const project = await storage.getProject(req.params.id)
  if (!project) return res.status(404).json({ error: 'project not found' })

  const lines = project.shots.map((shot: any) => [
    `=== Shot #${String(shot.order).padStart(2, '0')} (${shot.duration}s) ===`,
    `Scene: ${shot.scene}`,
    `Audio: ${shot.audioDescription}`,
    `Image Prompt: ${shot.imagePrompt}`,
    `Video Prompt: ${shot.videoPrompt}`,
    `Assets: ${shot.assetRefs.join(', ') || 'none'}`,
    '',
  ].join('\n'))

  res.set({
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Disposition': `attachment; filename="${project.name.replace(/[^a-zA-Zа-яА-Я0-9_-]/g, '_')}_prompts.txt"`,
  })
  res.send(lines.join('\n'))
})

export default router
```

**Step 3: Mount in `server/index.ts`**

```typescript
import exportRoutes from './routes/export.js'
app.use('/api/projects/:id', exportRoutes)
```

**Step 4: Commit**

```bash
git add server/routes/export.ts package.json server/index.ts
git commit -m "feat: add ZIP export and prompts-only export"
```

---

## Task 7: Frontend API client

**Files:**
- Create: `src/lib/api.ts`

**Step 1: Create `src/lib/api.ts`**

Thin wrapper over fetch for all backend calls:

```typescript
const BASE = '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

// Projects
export const api = {
  projects: {
    list: () => request<any[]>('/projects'),
    get: (id: string) => request<any>(`/projects/${id}`),
    create: (name: string) => request<any>('/projects', { method: 'POST', body: JSON.stringify({ name }) }),
    update: (id: string, data: any) => request<any>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),
  },

  assets: {
    upload: async (projectId: string, files: File[]) => {
      const form = new FormData()
      files.forEach((f) => form.append('files', f))
      const res = await fetch(`${BASE}/projects/${projectId}/assets`, { method: 'POST', body: form })
      if (!res.ok) throw new Error('Upload failed')
      return res.json()
    },
    delete: (projectId: string, assetId: string) =>
      request<void>(`/projects/${projectId}/assets/${assetId}`, { method: 'DELETE' }),
    url: (projectId: string, filename: string) =>
      `${BASE}/projects/${projectId}/assets/file/${encodeURIComponent(filename)}`,
  },

  generate: {
    script: (projectId: string) =>
      request<{ script: string }>(`/projects/${projectId}/generate-script`, { method: 'POST' }),
    splitShots: (projectId: string) =>
      request<{ shots: any[] }>(`/projects/${projectId}/split-shots`, { method: 'POST' }),
    image: (projectId: string, shotId: string) =>
      request<any>(`/projects/${projectId}/shots/${shotId}/generate-image`, { method: 'POST' }),
  },

  shots: {
    update: (projectId: string, shotId: string, data: any) =>
      request<any>(`/projects/${projectId}/shots/${shotId}`, { method: 'PUT', body: JSON.stringify(data) }),
    setStatus: (projectId: string, shotId: string, status: string) =>
      request<any>(`/projects/${projectId}/shots/${shotId}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
    uploadVideo: async (projectId: string, shotId: string, file: File) => {
      const form = new FormData()
      form.append('video', file)
      const res = await fetch(`${BASE}/projects/${projectId}/shots/${shotId}/video`, { method: 'POST', body: form })
      if (!res.ok) throw new Error('Upload failed')
      return res.json()
    },
    generatedImageUrl: (projectId: string, shotId: string, filename: string) =>
      `${BASE}/projects/${projectId}/shots/${shotId}/generated/${encodeURIComponent(filename)}`,
  },

  settings: {
    get: () => request<any>('/settings'),
    update: (data: any) => request<any>('/settings', { method: 'PUT', body: JSON.stringify(data) }),
  },

  export: {
    zipUrl: (projectId: string) => `${BASE}/projects/${projectId}/export`,
    promptsUrl: (projectId: string) => `${BASE}/projects/${projectId}/export/prompts`,
  },
}
```

**Step 2: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat: add frontend API client"
```

---

## Task 8: Connect Zustand store to real API

**Files:**
- Modify: `src/stores/projectStore.ts` (replace demo data with API calls)

**Step 1: Rewrite `projectStore.ts`**

Replace hardcoded demo data with API-backed state. Key changes:
- `loadProjects()` calls `api.projects.list()`
- `loadProject(id)` calls `api.projects.get(id)`
- All mutations (`updateShot`, `updateBriefText`, etc.) call API then update local state
- `generateScript()`, `splitShots()`, `generateImage()` call generation endpoints
- Remove all `DEMO_*` constants

Store actions become async: `updateShot` saves to API, then updates local state on success.

**Step 2: Commit**

```bash
git add src/stores/projectStore.ts
git commit -m "feat: connect store to backend API, remove demo data"
```

---

## Task 9: Connect UI components to real API

**Files:**
- Modify: `src/components/BriefEditor.tsx` (real file upload)
- Modify: `src/components/ShotDetail.tsx` (real generate/save/upload)
- Modify: `src/components/SettingsView.tsx` (real save/load)
- Modify: `src/components/ExportView.tsx` (real download links)
- Modify: `src/components/PipelineHeader.tsx` (real generate buttons)
- Modify: `src/App.tsx` (load project on mount)

**Step 1: BriefEditor — wire up file upload**

In the drop handler and button clicks, call `api.assets.upload()` with selected files. Show thumbnails using `api.assets.url()`.

**Step 2: ShotDetail — wire up generation + save**

- "Сгенерировать" button calls `api.generate.image()`
- "Утвердить" / "Вернуть" call `api.shots.setStatus()`
- Text field changes debounce-save via `api.shots.update()`
- "Загрузить из Higgsfield" opens file picker, calls `api.shots.uploadVideo()`
- Generated images display via `api.shots.generatedImageUrl()`

**Step 3: SettingsView — wire up save/load**

- On mount: load settings via `api.settings.get()`
- "Сохранить" button calls `api.settings.update()`

**Step 4: ExportView — wire up download links**

- "Экспортировать ZIP" → `window.open(api.export.zipUrl(projectId))`
- "Скачать только промпты" → `window.open(api.export.promptsUrl(projectId))`

**Step 5: PipelineHeader — wire up generate buttons**

- "Сгенерировать сценарий" → `store.generateScript()`
- "Разбить на шоты" → `store.splitShots()`
- "Генерировать" → generate images for all draft shots

**Step 6: App.tsx — load project list on mount**

```typescript
useEffect(() => { store.loadProjects() }, [])
```

**Step 7: Commit**

```bash
git add src/components/ src/App.tsx
git commit -m "feat: connect all UI components to backend API"
```

---

## Task 10: Add .gitignore + data directory

**Files:**
- Create: `.gitignore`

**Step 1: Create `.gitignore`**

```
node_modules/
dist/
data/
*.log
.env
```

**Step 2: Commit**

```bash
git init
git add .gitignore
git commit -m "chore: add gitignore, exclude data directory"
```

---

## Summary of execution order

| Task | Description | Dependencies |
|------|-------------|--------------|
| 1 | Backend scaffold + CRUD | none |
| 2 | Settings API | Task 1 |
| 3 | File upload | Task 1 |
| 4 | OpenRouter integration | Task 2 |
| 5 | Shot update + video upload | Task 1 |
| 6 | ZIP export | Task 1 |
| 7 | Frontend API client | Task 1 |
| 8 | Connect store to API | Task 7 |
| 9 | Connect UI to API | Task 8 |
| 10 | Gitignore + cleanup | none (anytime) |

Tasks 2-6 can run in parallel after Task 1. Tasks 8-9 are sequential after 7.
