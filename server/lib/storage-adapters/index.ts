import { LocalProjectStorageAdapter } from './local.js'
import type { ProjectStorageAdapter } from './types.js'

let cachedAdapter: ProjectStorageAdapter | null = null

export function getProjectStorageAdapter(): ProjectStorageAdapter {
  if (cachedAdapter) {
    return cachedAdapter
  }

  const adapterName = String(process.env.PROJECT_STORAGE_ADAPTER || 'local').trim().toLowerCase()

  switch (adapterName) {
    case 'local':
    default:
      cachedAdapter = new LocalProjectStorageAdapter()
      return cachedAdapter
  }
}

export type { ProjectStorageAdapter, ProjectStorageObjectRef, ProjectStoragePrefixRef, ProjectStorageRef } from './types.js'
