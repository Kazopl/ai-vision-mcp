/**
 * In-memory job store for the async tool pattern.
 *
 * Some MCP clients (Cursor among them) enforce a hard ~60s tool-call
 * timeout that progress notifications do not reliably reset. Long
 * operations (uploading + processing large videos) therefore run as
 * background jobs: start_video_analysis returns a job id immediately and
 * get_analysis_result polls until the job completes. The stdio server
 * process stays alive between tool calls, so in-memory state suffices.
 */

import crypto from 'crypto';

export interface Job {
  id: string;
  tool: string;
  status: 'running' | 'done' | 'error';
  message: string;
  startedAt: number;
  finishedAt?: number;
  result?: unknown;
  error?: string;
}

const jobs = new Map<string, Job>();

const FINISHED_JOB_TTL_MS = 30 * 60 * 1000; // keep results for 30 minutes
const MAX_JOBS = 100;

function cleanup(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.finishedAt && now - job.finishedAt > FINISHED_JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
  // Hard cap: drop the oldest finished jobs first
  if (jobs.size > MAX_JOBS) {
    const finished = [...jobs.values()]
      .filter(job => job.status !== 'running')
      .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
    for (const job of finished) {
      if (jobs.size <= MAX_JOBS) break;
      jobs.delete(job.id);
    }
  }
}

/**
 * Start a background job. The runner receives an update callback for
 * human-readable stage messages surfaced through get_analysis_result.
 */
export function startJob(
  tool: string,
  runner: (update: (message: string) => void) => Promise<unknown>
): Job {
  cleanup();

  const job: Job = {
    id: crypto.randomBytes(8).toString('hex'),
    tool,
    status: 'running',
    message: 'starting',
    startedAt: Date.now(),
  };
  jobs.set(job.id, job);

  const update = (message: string) => {
    job.message = message;
  };

  runner(update)
    .then(result => {
      job.status = 'done';
      job.result = result;
      job.message = 'completed';
      job.finishedAt = Date.now();
    })
    .catch(error => {
      job.status = 'error';
      job.error = error instanceof Error ? error.message : String(error);
      job.message = 'failed';
      job.finishedAt = Date.now();
    });

  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}
