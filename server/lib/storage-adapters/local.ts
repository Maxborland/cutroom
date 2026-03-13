import fs from 'node:fs/promises'
import { ensureDir, resolveProjectPath } from '../storage.js'
import type { ProjectStorageAdapter, ProjectStorageObjectRef, ProjectStoragePrefixRef, ProjectStorageRef } from './types.js'

function resolveLocalPath(ref: ProjectStorageRef): string {
  switch (ref.scope) {
    case 'brief-images':
      return 'filename' in ref
        ? resolveProjectPath(ref.projectId, 'brief', 'images', ref.filename)
        : resolveProjectPath(ref.projectId, 'brief', 'images')
    case 'shot-generated':
      return 'filename' in ref
        ? resolveProjectPath(ref.projectId, 'shots', ref.shotId, 'generated', ref.filename)
        : resolveProjectPath(ref.projectId, 'shots', ref.shotId, 'generated')
    case 'shot-video':
      return 'filename' in ref
        ? resolveProjectPath(ref.projectId, 'shots', ref.shotId, 'video', ref.filename)
        : resolveProjectPath(ref.projectId, 'shots', ref.shotId, 'video')
    case 'shot-reference':
      return 'filename' in ref
        ? resolveProjectPath(ref.projectId, 'shots', ref.shotId, 'reference', ref.filename)
        : resolveProjectPath(ref.projectId, 'shots', ref.shotId, 'reference')
    case 'montage':
      return 'filename' in ref
        ? resolveProjectPath(ref.projectId, 'montage', ref.filename)
        : resolveProjectPath(ref.projectId, 'montage')
    case 'export':
      return 'filename' in ref
        ? resolveProjectPath(ref.projectId, 'montage', 'exports', ref.filename)
        : resolveProjectPath(ref.projectId, 'montage', 'exports')
    case 'render':
      return 'filename' in ref
        ? resolveProjectPath(ref.projectId, 'montage', 'renders', ref.filename)
        : resolveProjectPath(ref.projectId, 'montage', 'renders')
    case 'normalized':
      return 'filename' in ref
        ? resolveProjectPath(ref.projectId, 'montage', 'normalized', ref.filename)
        : resolveProjectPath(ref.projectId, 'montage', 'normalized')
  }
}

export class LocalProjectStorageAdapter implements ProjectStorageAdapter {
  async ensureContainer(ref: ProjectStoragePrefixRef): Promise<void> {
    await ensureDir(resolveLocalPath(ref))
  }

  async writeBuffer(ref: ProjectStorageObjectRef, buffer: Buffer): Promise<void> {
    await this.ensureContainer(toPrefix(ref))
    await fs.writeFile(resolveLocalPath(ref), buffer)
  }

  readBuffer(ref: ProjectStorageObjectRef): Promise<Buffer> {
    return fs.readFile(resolveLocalPath(ref))
  }

  async deleteObject(ref: ProjectStorageObjectRef): Promise<void> {
    await fs.unlink(resolveLocalPath(ref)).catch(() => undefined)
  }

  async exists(ref: ProjectStorageObjectRef): Promise<boolean> {
    try {
      await fs.access(resolveLocalPath(ref))
      return true
    } catch {
      return false
    }
  }

  async listObjects(ref: ProjectStoragePrefixRef): Promise<string[]> {
    const dirPath = resolveLocalPath(ref)

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      return entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
    } catch {
      return []
    }
  }

  getReadablePathForServer(ref: ProjectStorageRef): string {
    return resolveLocalPath(ref)
  }

  getPublicUrl(ref: ProjectStorageObjectRef): string | null {
    switch (ref.scope) {
      case 'brief-images':
        return `/api/projects/${ref.projectId}/assets/file/${encodeURIComponent(ref.filename)}`
      case 'shot-generated':
        return `/api/projects/${ref.projectId}/shots/${ref.shotId}/generated/${encodeURIComponent(ref.filename)}`
      case 'shot-video':
        return `/api/projects/${ref.projectId}/shots/${ref.shotId}/video/${encodeURIComponent(ref.filename)}`
      default:
        return null
    }
  }
}

function toPrefix(ref: ProjectStorageObjectRef): ProjectStoragePrefixRef {
  if ('shotId' in ref) {
    return {
      projectId: ref.projectId,
      scope: ref.scope,
      shotId: ref.shotId,
    }
  }

  return {
    projectId: ref.projectId,
    scope: ref.scope,
  }
}
