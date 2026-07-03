import { CampaignGenerationProcessor } from './campaign-generation.processor';
import {
  CAMPAIGN_GENERATION_JOB,
  CAMPAIGN_GENERATION_RECOVERY_JOB,
} from './sequence-queue.constants';

describe('CampaignGenerationProcessor', () => {
  let campaignsService: any;
  let processor: CampaignGenerationProcessor;

  beforeEach(() => {
    campaignsService = {
      processCampaignDraftGeneration: jest.fn(),
      recoverStaleCampaignGenerations: jest.fn(),
    };
    processor = new CampaignGenerationProcessor(campaignsService);
  });

  it('handles normal campaign generation jobs', async () => {
    const data = {
      userId: 'user-1',
      campaignId: 'campaign-1',
      generationAttemptId: 'attempt-1',
      dto: {
        name: 'Generated sequence',
        templateId: 'cold-intro',
        goal: 'Book calls',
        audienceDescription: 'Founders',
        groupIds: [],
        contactIds: [],
      },
    };

    await processor.process({ name: CAMPAIGN_GENERATION_JOB, data } as any);

    expect(campaignsService.processCampaignDraftGeneration).toHaveBeenCalledWith(
      data,
    );
    expect(campaignsService.recoverStaleCampaignGenerations).not.toHaveBeenCalled();
  });

  it('handles stale generation recovery dispatcher jobs', async () => {
    await processor.process({
      name: CAMPAIGN_GENERATION_RECOVERY_JOB,
      data: {},
    } as any);

    expect(campaignsService.recoverStaleCampaignGenerations).toHaveBeenCalledTimes(1);
    expect(campaignsService.processCampaignDraftGeneration).not.toHaveBeenCalled();
  });
});
