import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MongooseModule } from '@nestjs/mongoose';
import { Campaign, CampaignSchema } from './schemas/campaign.schema';
import {
  CampaignRecipient,
  CampaignRecipientSchema,
} from './schemas/campaign-recipient.schema';
import {
  OutboxMessage,
  OutboxMessageSchema,
} from './schemas/outbox-message.schema';
import {
  CampaignTemplate,
  CampaignTemplateSchema,
  PromptTemplate,
  PromptTemplateSchema,
} from './schemas/campaign-template.schema';
import {
  LlmQuotaUsage,
  LlmQuotaUsageSchema,
} from './schemas/llm-quota-usage.schema';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { CampaignTemplatesController } from './campaign-templates.controller';
import { CampaignGenerationProcessor } from './campaign-generation.processor';
import { SequenceEmailProcessor } from './sequence-email.processor';
import {
  CAMPAIGN_GENERATION_QUEUE,
  SEQUENCE_EMAIL_QUEUE,
} from './sequence-queue.constants';
import { ContactsModule } from '../contacts/contacts.module';
import { GroupsModule } from '../groups/groups.module';
import { LlmModule } from '../../shared/llm/llm.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Campaign.name, schema: CampaignSchema },
      { name: CampaignRecipient.name, schema: CampaignRecipientSchema },
      { name: OutboxMessage.name, schema: OutboxMessageSchema },
      { name: CampaignTemplate.name, schema: CampaignTemplateSchema },
      { name: PromptTemplate.name, schema: PromptTemplateSchema },
      { name: LlmQuotaUsage.name, schema: LlmQuotaUsageSchema },
    ]),
    BullModule.registerQueue(
      { name: SEQUENCE_EMAIL_QUEUE },
      { name: CAMPAIGN_GENERATION_QUEUE },
    ),
    ContactsModule,
    GroupsModule,
    LlmModule,
  ],
  controllers: [CampaignsController, CampaignTemplatesController],
  providers: [CampaignsService, SequenceEmailProcessor, CampaignGenerationProcessor],
})
export class CampaignsModule {}
