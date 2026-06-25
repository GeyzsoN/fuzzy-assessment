import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { CampaignsService } from './campaigns.service';
import { GenerateCampaignDraftDto } from './dtos/generate-campaign-draft.dto';
import {
  CAMPAIGN_GENERATION_JOB,
  CAMPAIGN_GENERATION_QUEUE,
} from './sequence-queue.constants';

@Processor(CAMPAIGN_GENERATION_QUEUE, { concurrency: 2 })
export class CampaignGenerationProcessor extends WorkerHost {
  constructor(private readonly campaignsService: CampaignsService) {
    super();
  }

  async process(
    job: Job<{
      userId: string;
      campaignId: string;
      dto: GenerateCampaignDraftDto;
    }>,
  ) {
    if (job.name !== CAMPAIGN_GENERATION_JOB) {
      return;
    }

    await this.campaignsService.processCampaignDraftGeneration(job.data);
  }
}
