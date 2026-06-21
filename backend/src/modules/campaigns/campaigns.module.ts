import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Campaign, CampaignSchema } from './schemas/campaign.schema';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { ContactsModule } from '../contacts/contacts.module';
import { LlmModule } from '../../shared/llm/llm.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Campaign.name, schema: CampaignSchema }]),
    ContactsModule,
    LlmModule,
  ],
  controllers: [CampaignsController],
  providers: [CampaignsService],
})
export class CampaignsModule {}
