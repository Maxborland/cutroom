import { describe, expect, it } from 'vitest'
import type { Project } from '../../server/lib/storage.js'

function createFakeProjectsDb() {
  const rows = new Map<string, any>()
  const queries: string[] = []

  return {
    db: {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push(sql)

        if (sql.includes('SELECT') && sql.includes('FROM projects') && sql.includes('WHERE id = $1')) {
          const row = rows.get(params[0] as string)
          return { rows: row ? [row] : [] }
        }

        if (sql.includes('SELECT') && sql.includes('FROM projects') && sql.includes('ORDER BY created_at DESC')) {
          return {
            rows: [...rows.values()].sort((a, b) => {
              return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            }),
          }
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
            created_at: rows.get(id)?.created_at ?? createdAt,
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
      },
    },
    queries,
  }
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: overrides.id ?? 'project-1',
    name: overrides.name ?? 'Pilot',
    created: overrides.created ?? '2026-03-13T00:00:00.000Z',
    updated: overrides.updated ?? '2026-03-13T00:00:00.000Z',
    stage: overrides.stage ?? 'brief',
    settings: overrides.settings ?? {
      scriptwriterPrompt: 'script',
      shotSplitterPrompt: 'split',
      model: 'openai/gpt-4o',
      temperature: 0.7,
    },
    brief: overrides.brief ?? { text: 'brief', assets: [], targetDuration: 60 },
    script: overrides.script ?? '',
    shots: overrides.shots ?? [],
    voiceoverScript: overrides.voiceoverScript,
    voiceoverScriptApproved: overrides.voiceoverScriptApproved,
    voiceoverFile: overrides.voiceoverFile,
    voiceoverProvider: overrides.voiceoverProvider,
    voiceoverVoiceId: overrides.voiceoverVoiceId,
    musicFile: overrides.musicFile,
    musicPrompt: overrides.musicPrompt,
    musicProvider: overrides.musicProvider,
    montagePlan: overrides.montagePlan,
    renders: overrides.renders,
  }
}

describe('Postgres project repository', () => {
  it('persists and reads a project through postgres row mapping', async () => {
    const fake = createFakeProjectsDb()
    const { createProjectRepository } = await import('../../server/lib/projects/repository.js')

    const repository = createProjectRepository({ db: fake.db } as any)
    const project = makeProject({
      id: 'project-123',
      name: 'DB Pilot',
      stage: 'shots',
      script: 'Scene 1',
      shots: [
        {
          id: 'shot-001',
          order: 0,
          scene: 'Facade',
          audioDescription: '',
          imagePrompt: 'Prompt',
          videoPrompt: 'Video prompt',
          duration: 5,
          assetRefs: [],
          status: 'draft',
          generatedImages: [],
          enhancedImages: [],
          selectedImage: null,
          videoFile: null,
        },
      ],
    })

    await repository.saveProject(project)
    const fetched = await repository.getProject('project-123')

    expect(fetched).toEqual(project)
    expect(fake.queries.some((sql) => sql.includes('INSERT INTO projects'))).toBe(true)
    expect(fake.queries.some((sql) => sql.includes('FROM projects'))).toBe(true)
  })

  it('preserves the original created timestamp when updating an existing project', async () => {
    const fake = createFakeProjectsDb()
    const { createProjectRepository } = await import('../../server/lib/projects/repository.js')

    const repository = createProjectRepository({ db: fake.db } as any)
    const created = makeProject({
      id: 'project-created-at',
      created: '2026-03-01T00:00:00.000Z',
      updated: '2026-03-01T00:00:00.000Z',
    })

    await repository.saveProject(created)

    const updated = await repository.saveProject({
      ...created,
      name: 'Renamed',
      created: '2026-03-15T00:00:00.000Z',
      updated: '2026-03-15T00:00:00.000Z',
    })

    expect(updated.created).toBe('2026-03-01T00:00:00.000Z')
  })
})
