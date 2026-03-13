import type { Pool } from 'pg'
import { createDb } from '../../db/index.js'
import type { Project } from '../storage.js'
import { mapProjectRow, mapProjectToRow, type ProjectRow } from './mapper.js'

type ProjectsDb = Pick<Pool, 'query'>

interface CreateProjectRepositoryOptions {
  db?: ProjectsDb
  connectionString?: string
}

export interface ProjectRepository {
  listProjects(): Promise<Project[]>
  getProject(projectId: string): Promise<Project | null>
  saveProject(project: Project): Promise<Project>
  deleteProject(projectId: string): Promise<boolean>
}

export class PostgresProjectRepository implements ProjectRepository {
  private readonly db: ProjectsDb

  constructor(options: CreateProjectRepositoryOptions = {}) {
    this.db = options.db ?? createDb(options.connectionString)
  }

  async listProjects(): Promise<Project[]> {
    const result = await this.db.query<ProjectRow>(
      `
        SELECT id, name, created_at, updated_at, stage, payload
        FROM projects
        ORDER BY created_at DESC
      `,
    )

    return result.rows.map((row) => mapProjectRow(row)).filter((project): project is Project => Boolean(project))
  }

  async getProject(projectId: string): Promise<Project | null> {
    const result = await this.db.query<ProjectRow>(
      `
        SELECT id, name, created_at, updated_at, stage, payload
        FROM projects
        WHERE id = $1
        LIMIT 1
      `,
      [projectId],
    )

    return mapProjectRow(result.rows[0])
  }

  async saveProject(project: Project): Promise<Project> {
    const row = mapProjectToRow(project)
    const result = await this.db.query<ProjectRow>(
      `
        INSERT INTO projects (id, name, created_at, updated_at, stage, payload)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          updated_at = EXCLUDED.updated_at,
          stage = EXCLUDED.stage,
          payload = EXCLUDED.payload
        RETURNING id, name, created_at, updated_at, stage, payload
      `,
      [row.id, row.name, row.createdAt, row.updatedAt, row.stage, row.payload],
    )

    return mapProjectRow(result.rows[0]) as Project
  }

  async deleteProject(projectId: string): Promise<boolean> {
    const result = await this.db.query(
      `
        DELETE FROM projects
        WHERE id = $1
      `,
      [projectId],
    )

    return Number(result.rowCount ?? 0) > 0
  }
}

export function createProjectRepository(options: CreateProjectRepositoryOptions = {}): ProjectRepository {
  return new PostgresProjectRepository(options)
}
