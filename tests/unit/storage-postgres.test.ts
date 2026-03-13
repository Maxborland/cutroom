import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'

afterEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  vi.doUnmock('../../server/db/index.js')
})

function createFakeProjectsDb() {
  const rows = new Map<string, any>()
  const queries: string[] = []

  return {
    queries,
    db: {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        queries.push(sql)

        if (sql.includes('SELECT') && sql.includes('FROM projects') && sql.includes('WHERE id = $1')) {
          const row = rows.get(params[0] as string)
          return { rows: row ? [row] : [] }
        }

        if (sql.includes('SELECT') && sql.includes('FROM projects') && sql.includes('ORDER BY created_at DESC')) {
          return { rows: [...rows.values()] }
        }

        if (sql.includes('INSERT INTO projects')) {
          const [id, name, createdAt, updatedAt, stage, payload] = params as [
            string,
            string,
            string,
            string,
            string,
            Record<string, unknown>,
          ]
          const row = {
            id,
            name,
            created_at: createdAt,
            updated_at: updatedAt,
            stage,
            payload,
          }
          rows.set(id, row)
          return { rows: [row] }
        }

        if (sql.includes('DELETE FROM projects')) {
          rows.delete(params[0] as string)
          return { rowCount: 1, rows: [] }
        }

        throw new Error(`Unexpected SQL in fake projects db: ${sql}`)
      }),
    },
  }
}

describe('storage postgres delegation', () => {
  it('uses postgres-backed metadata persistence when a database is available', async () => {
    const fake = createFakeProjectsDb()
    vi.doMock('../../server/db/index.js', () => ({
      createDb: vi.fn(() => fake.db),
    }))

    const storage = await import('../../server/lib/storage.js')
    const project = await storage.createProject('DB-backed project')

    expect(project.name).toBe('DB-backed project')
    expect(fake.queries.some((sql) => sql.includes('INSERT INTO projects'))).toBe(true)

    const fetched = await storage.getProject(project.id)
    expect(fetched?.name).toBe('DB-backed project')

    const filePath = storage.resolveProjectPath(project.id, 'project.json')
    await expect(fs.access(filePath)).rejects.toThrow()

    await storage.deleteProject(project.id)
    expect(fake.queries.some((sql) => sql.includes('DELETE FROM projects'))).toBe(true)
  })

  it('backfills a legacy project.json into postgres on first read', async () => {
    const fake = createFakeProjectsDb()
    const legacyId = 'legacy-project'
    const legacyDir = path.resolve(process.cwd(), 'data', 'projects', legacyId)
    await fs.mkdir(legacyDir, { recursive: true })
    await fs.writeFile(
      path.join(legacyDir, 'project.json'),
      JSON.stringify({
        id: legacyId,
        name: 'Legacy Project',
        created: '2026-03-01T00:00:00.000Z',
        updated: '2026-03-01T00:00:00.000Z',
        stage: 'brief',
        settings: {
          scriptwriterPrompt: 'script',
          shotSplitterPrompt: 'split',
          model: 'openai/gpt-4o',
          temperature: 0.7,
        },
        brief: { text: '', assets: [], targetDuration: 60 },
        script: '',
        shots: [],
      }),
      'utf-8',
    )

    vi.doMock('../../server/db/index.js', () => ({
      createDb: vi.fn(() => fake.db),
    }))

    const storage = await import('../../server/lib/storage.js')
    const project = await storage.getProject(legacyId)

    expect(project?.name).toBe('Legacy Project')
    expect(fake.queries.some((sql) => sql.includes('INSERT INTO projects'))).toBe(true)

    await fs.rm(legacyDir, { recursive: true, force: true })
  })
})
