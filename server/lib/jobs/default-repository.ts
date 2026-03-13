import { createJobsRepository } from './repository.js'
import type { JobsRepository } from './types.js'

let cachedJobsRepository: JobsRepository | null | undefined

export function getDefaultJobsRepository(): JobsRepository | null {
  if (cachedJobsRepository !== undefined) {
    return cachedJobsRepository
  }

  try {
    cachedJobsRepository = createJobsRepository()
  } catch {
    cachedJobsRepository = null
  }

  return cachedJobsRepository
}
