import { runNextRenderJob } from '../render-worker.js'
import { runNextExportJob } from './export.js'
import { runNextVideoCacheJob } from './video-cache.js'

interface RunJobsWorkerOptions {
  once?: boolean
  pollIntervalMs?: number
  workerId?: string
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function runJobsWorker({
  once = false,
  pollIntervalMs = 2_000,
  workerId,
}: RunJobsWorkerOptions = {}): Promise<void> {
  let keepRunning = true

  while (keepRunning) {
    const processedRender = await runNextRenderJob(workerId)
    const processedExport = processedRender ? false : await runNextExportJob(workerId)
    const processedVideoCache = processedRender || processedExport ? false : await runNextVideoCacheJob(workerId)
    const processed = processedRender || processedExport || processedVideoCache

    if (once) {
      keepRunning = false
      continue
    }

    if (!processed) {
      await delay(pollIntervalMs)
    }
  }
}
