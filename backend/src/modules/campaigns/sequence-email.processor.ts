import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { CampaignsService } from './campaigns.service';
import {
  DISPATCH_DUE_SEQUENCE_EMAILS_JOB,
  SEQUENCE_EMAIL_JOB,
  SEQUENCE_EMAIL_QUEUE,
} from './sequence-queue.constants';

@Processor(SEQUENCE_EMAIL_QUEUE, { concurrency: 3 })
export class SequenceEmailProcessor extends WorkerHost {
  private readonly logger = new Logger(SequenceEmailProcessor.name);

  constructor(private readonly campaignsService: CampaignsService) {
    super();
  }

  async process(job: Job<{ outboxId?: string }>) {
    if (job.name === DISPATCH_DUE_SEQUENCE_EMAILS_JOB) {
      await this.campaignsService.dispatchDueOutboxMessages();
      return;
    }

    if (job.name !== SEQUENCE_EMAIL_JOB) {
      return;
    }

    if (job.data.outboxId) {
      await this.campaignsService.processOutboxMessage(job.data.outboxId);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error) {
    this.logger.error(
      `Sequence email job failed jobId=${job?.id || 'unknown'} name=${job?.name || 'unknown'} attemptsMade=${job?.attemptsMade ?? 0}`,
      error.stack,
    );
  }
}
