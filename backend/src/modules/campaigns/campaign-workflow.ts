import { BadRequestException } from '@nestjs/common';
import { CampaignStatus, GenerationStatus } from './schemas/campaign.schema';
import { OutboxStatus } from './schemas/outbox-message.schema';

export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  [CampaignStatus.DRAFT]: [
    CampaignStatus.GENERATING,
    CampaignStatus.LAUNCHING,
    CampaignStatus.FAILED,
  ],
  [CampaignStatus.GENERATING]: [CampaignStatus.DRAFT, CampaignStatus.FAILED],
  [CampaignStatus.LAUNCHING]: [CampaignStatus.RUNNING, CampaignStatus.FAILED],
  [CampaignStatus.RUNNING]: [CampaignStatus.COMPLETED, CampaignStatus.FAILED],
  [CampaignStatus.COMPLETED]: [],
  [CampaignStatus.FAILED]: [CampaignStatus.GENERATING],
};

export const OUTBOX_TRANSITIONS: Record<OutboxStatus, OutboxStatus[]> = {
  [OutboxStatus.QUEUED]: [OutboxStatus.PROCESSING, OutboxStatus.FAILED],
  [OutboxStatus.PROCESSING]: [OutboxStatus.SENT, OutboxStatus.FAILED],
  [OutboxStatus.SENT]: [],
  [OutboxStatus.FAILED]: [OutboxStatus.PROCESSING],
};

export const GENERATION_TRANSITIONS: Record<
  GenerationStatus,
  GenerationStatus[]
> = {
  [GenerationStatus.NOT_GENERATED]: [
    GenerationStatus.PENDING,
    GenerationStatus.FAILED,
  ],
  [GenerationStatus.PENDING]: [
    GenerationStatus.FINISHED,
    GenerationStatus.FAILED,
  ],
  [GenerationStatus.FINISHED]: [],
  [GenerationStatus.FAILED]: [GenerationStatus.PENDING],
};

export function assertCampaignTransition(
  from: CampaignStatus,
  to: CampaignStatus,
) {
  assertTransition('Campaign', CAMPAIGN_TRANSITIONS, from, to);
}

export function assertOutboxTransition(from: OutboxStatus, to: OutboxStatus) {
  assertTransition('Outbox', OUTBOX_TRANSITIONS, from, to);
}

export function assertGenerationTransition(
  from: GenerationStatus,
  to: GenerationStatus,
) {
  assertTransition('Generation', GENERATION_TRANSITIONS, from, to);
}

function assertTransition<TStatus extends string>(
  label: string,
  transitions: Record<TStatus, TStatus[]>,
  from: TStatus,
  to: TStatus,
) {
  if (from === to) {
    return;
  }
  if (!transitions[from]?.includes(to)) {
    throw new BadRequestException(
      `${label} cannot transition from ${from} to ${to}`,
    );
  }
}
