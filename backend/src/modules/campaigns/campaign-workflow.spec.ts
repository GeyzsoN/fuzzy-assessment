import { CampaignStatus, GenerationStatus } from './schemas/campaign.schema';
import { OutboxStatus } from './schemas/outbox-message.schema';
import {
  assertCampaignTransition,
  assertGenerationTransition,
  assertOutboxTransition,
} from './campaign-workflow';

describe('campaign workflow transitions', () => {
  it('allows legal campaign state transitions', () => {
    expect(() =>
      assertCampaignTransition(CampaignStatus.DRAFT, CampaignStatus.LAUNCHING),
    ).not.toThrow();
    expect(() =>
      assertCampaignTransition(CampaignStatus.RUNNING, CampaignStatus.COMPLETED),
    ).not.toThrow();
  });

  it('rejects illegal campaign state transitions', () => {
    expect(() =>
      assertCampaignTransition(CampaignStatus.COMPLETED, CampaignStatus.RUNNING),
    ).toThrow('Campaign cannot transition from completed to running');
  });

  it('allows legal outbox state transitions', () => {
    expect(() =>
      assertOutboxTransition(OutboxStatus.QUEUED, OutboxStatus.PROCESSING),
    ).not.toThrow();
    expect(() =>
      assertOutboxTransition(OutboxStatus.PROCESSING, OutboxStatus.SENT),
    ).not.toThrow();
  });

  it('rejects illegal outbox state transitions', () => {
    expect(() =>
      assertOutboxTransition(OutboxStatus.SENT, OutboxStatus.PROCESSING),
    ).toThrow('Outbox cannot transition from sent to processing');
  });

  it('allows retrying failed generation but rejects regenerating finished work', () => {
    expect(() =>
      assertGenerationTransition(GenerationStatus.FAILED, GenerationStatus.PENDING),
    ).not.toThrow();
    expect(() =>
      assertGenerationTransition(GenerationStatus.FINISHED, GenerationStatus.PENDING),
    ).toThrow('Generation cannot transition from finished to pending');
  });
});
