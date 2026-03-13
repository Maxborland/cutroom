export type ProjectStorageScope =
  | 'brief-images'
  | 'shot-generated'
  | 'shot-video'
  | 'shot-reference'
  | 'montage'
  | 'export'
  | 'render'
  | 'normalized'

export type ProjectStoragePrefixRef =
  | {
      projectId: string
      scope: 'brief-images' | 'montage' | 'export' | 'render' | 'normalized'
    }
  | {
      projectId: string
      scope: 'shot-generated' | 'shot-video' | 'shot-reference'
      shotId: string
    }

export type ProjectStorageObjectRef =
  | (Extract<ProjectStoragePrefixRef, { scope: 'brief-images' | 'montage' | 'export' | 'render' | 'normalized' }> & {
      filename: string
    })
  | (Extract<ProjectStoragePrefixRef, { scope: 'shot-generated' | 'shot-video' | 'shot-reference' }> & {
      filename: string
    })

export type ProjectStorageRef = ProjectStoragePrefixRef | ProjectStorageObjectRef

export interface ProjectStorageAdapter {
  ensureContainer(ref: ProjectStoragePrefixRef): Promise<void>
  writeBuffer(ref: ProjectStorageObjectRef, buffer: Buffer): Promise<void>
  readBuffer(ref: ProjectStorageObjectRef): Promise<Buffer>
  deleteObject(ref: ProjectStorageObjectRef): Promise<void>
  exists(ref: ProjectStorageObjectRef): Promise<boolean>
  listObjects(ref: ProjectStoragePrefixRef): Promise<string[]>
  getReadablePathForServer(ref: ProjectStorageRef): string
  getPublicUrl(ref: ProjectStorageObjectRef): string | null
}
