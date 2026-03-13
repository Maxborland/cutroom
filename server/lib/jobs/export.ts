import { getProject } from '../storage.js';
import { writeProjectArchive } from '../export-archive.js';
import { getDefaultJobsRepository } from './default-repository.js';
import type { BackgroundJob } from './types.js';

interface ExportJobPayload {
  requestedAt: string;
}

interface ExportJobResult {
  outputFile: string;
}

export async function enqueueExportJob(projectId: string): Promise<string | null> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  const jobsRepository = getDefaultJobsRepository();
  if (!jobsRepository) {
    const filename = `export-${Date.now()}.zip`;
    await writeProjectArchive(projectId, filename);
    return null;
  }

  const jobId = `export-${Date.now()}`;
  await jobsRepository.enqueueJob<ExportJobPayload>({
    id: jobId,
    projectId,
    jobType: 'export',
    payload: {
      requestedAt: new Date().toISOString(),
    },
  });

  return jobId;
}

export async function getExportJob(jobId: string): Promise<BackgroundJob<ExportJobPayload, ExportJobResult> | null> {
  const jobsRepository = getDefaultJobsRepository();
  if (!jobsRepository) {
    return null;
  }

  return jobsRepository.getJob<ExportJobPayload, ExportJobResult>(jobId);
}

export async function runNextExportJob(workerId = `export-worker-${process.pid}`): Promise<boolean> {
  const jobsRepository = getDefaultJobsRepository();
  if (!jobsRepository) {
    return false;
  }

  const claimedJob = await jobsRepository.claimNextJob<ExportJobPayload, ExportJobResult>('export', workerId);
  if (!claimedJob) {
    return false;
  }

  try {
    const outputFile = await writeProjectArchive(claimedJob.projectId, `${claimedJob.id}.zip`);
    await jobsRepository.markJobDone(claimedJob.id, { outputFile });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await jobsRepository.markJobFailed(claimedJob.id, message);
  }

  return true;
}
