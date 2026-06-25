import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { CampaignsService } from './campaigns.service';
import { SEQUENCE_EMAIL_QUEUE } from './sequence-queue.constants';

@Processor(SEQUENCE_EMAIL_QUEUE, { concurrency: 3 })
export class SequenceEmailProcessor extends WorkerHost {
  constructor(private readonly campaignsService: CampaignsService) {
    super();
  }

  async process(job: Job<{ outboxId: string }>) {
    await this.campaignsService.processOutboxMessage(job.data.outboxId);
  }
}
