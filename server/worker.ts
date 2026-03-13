import { runJobsWorker } from './lib/jobs/worker.js'

void runJobsWorker().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  console.error('[worker] Background jobs worker crashed:', message)
  process.exitCode = 1
})
