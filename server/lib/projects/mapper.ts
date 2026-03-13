import type { Project } from '../storage.js'

export type ProjectRow = {
  id: string
  name: string
  created_at: Date | string
  updated_at: Date | string
  stage: string
  payload: Record<string, unknown> | null
}

function normalizeTimestampValue(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

export function mapProjectRow(row: ProjectRow | undefined): Project | null {
  if (!row) {
    return null
  }

  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {}

  return {
    ...(payload as Omit<Project, 'id' | 'name' | 'created' | 'updated' | 'stage'>),
    id: row.id,
    name: row.name,
    created: normalizeTimestampValue(row.created_at),
    updated: normalizeTimestampValue(row.updated_at),
    stage: row.stage,
  } as Project
}

export function mapProjectToRow(project: Project) {
  const { id, name, created, updated, stage, ...payload } = project

  return {
    id,
    name,
    createdAt: created,
    updatedAt: updated,
    stage,
    payload,
  }
}
