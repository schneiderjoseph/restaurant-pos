import { nanoid } from 'nanoid';
import { IntegrationQueueJob, QueueStore, RetryPolicy } from '@/integrations/queue/types.ts';
import { RetryEngine } from '@/integrations/queue/retry-engine.ts';

type QueueExecutor = (job: IntegrationQueueJob) => Promise<void>;

export class IntegrationQueueEngine {
  private readonly retryEngine: RetryEngine;

  constructor(
    private readonly store: QueueStore,
    policy?: Partial<RetryPolicy>
  ) {
    this.retryEngine = new RetryEngine({
      maxRetries: policy?.maxRetries ?? 5,
      baseDelayMs: policy?.baseDelayMs ?? 1000,
      maxDelayMs: policy?.maxDelayMs ?? 60_000,
      jitter: policy?.jitter ?? true,
    });
  }

  async enqueue(input: Omit<IntegrationQueueJob, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'attempts'>) {
    if (input.dedupeKey) {
      const duplicate = await this.store.findByDedupeKey(input.dedupeKey);
      // Only reuse in-flight jobs — Completed/Failed/DeadLetter must not block a new enqueue.
      if (
        duplicate &&
        (duplicate.status === 'Pending' || duplicate.status === 'Running' || duplicate.status === 'Waiting')
      ) {
        return duplicate;
      }
    }

    const now = new Date().toISOString();
    const job: IntegrationQueueJob = {
      ...input,
      id: `integration_job:${nanoid()}`,
      status: 'Pending',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.save(job);
    return job;
  }

  /** Picks the next ready job and marks it Running, one caller at a time. */
  private async claimNext(): Promise<IntegrationQueueJob | null> {
    const claim = async () => {
      const ready = await this.store.listByStatus(['Pending', 'Waiting']);
      const now = Date.now();
      const candidates = ready
        .filter((job) => !job.nextRunAt || new Date(job.nextRunAt).getTime() <= now)
        .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt));
      const job = candidates[0];
      if (!job) return null;

      job.status = 'Running';
      job.updatedAt = new Date().toISOString();
      await this.store.update(job);
      return job;
    };

    // Web Locks span every tab of this browser (they share the IndexedDB queue);
    // without them, chain the claims within this tab.
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (locks?.request) {
      return locks.request('integration-queue-claim', claim);
    }
    const next = this.claimChain.then(claim, claim);
    this.claimChain = next.catch(() => undefined);
    return next;
  }

  private claimChain: Promise<unknown> = Promise.resolve();

  async processNext(executor: QueueExecutor) {
    const job = await this.claimNext();
    if (!job) return null;

    try {
      await executor(job);
      job.status = 'Completed';
      job.lastError = undefined;
      job.updatedAt = new Date().toISOString();
      await this.store.update(job);
      return job;
    } catch (error) {
      job.attempts += 1;
      job.lastError = error instanceof Error ? error.message : String(error);
      job.updatedAt = new Date().toISOString();
      if (this.retryEngine.canRetry(job.attempts) && job.attempts <= job.maxRetries) {
        job.status = 'Waiting';
        const delayMs = this.retryEngine.getDelayMs(job.attempts);
        job.nextRunAt =
          delayMs > 0 ? new Date(Date.now() + delayMs).toISOString() : undefined;
      } else {
        job.status = 'DeadLetter';
      }
      await this.store.update(job);
      return job;
    }
  }

  async listActiveJobs() {
    // Include DeadLetter so failed fiscal retries remain visible after offline buffering.
    const jobs = await this.store.listByStatus(['Pending', 'Running', 'Waiting', 'DeadLetter']);
    return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
