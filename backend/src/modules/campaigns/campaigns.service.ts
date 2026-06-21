import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Campaign, CampaignDocument } from './schemas/campaign.schema';
import { CreateCampaignDto } from './dtos/create-campaign.dto';
import { AttachContactsDto } from './dtos/attach-contacts.dto';
import { ContactsService } from '../contacts/contacts.service';
import { LlmService } from '../../shared/llm/llm.service';

@Injectable()
export class CampaignsService {
  constructor(
    @InjectModel(Campaign.name)
    private readonly campaignModel: Model<CampaignDocument>,
    private readonly contactsService: ContactsService,
    private readonly llm: LlmService,
  ) {}

  async create(userId: string, dto: CreateCampaignDto): Promise<Campaign> {
    // TODO(candidate): create a user-scoped campaign.
    throw new Error('Not implemented');
  }

  async getOne(userId: string, campaignId: string): Promise<Campaign> {
    // TODO(candidate): fetch a campaign scoped to userId (404 if not found/owned).
    throw new Error('Not implemented');
  }

  async attachContacts(
    userId: string,
    campaignId: string,
    dto: AttachContactsDto,
  ): Promise<Campaign> {
    // TODO(candidate): attach existing (user-owned) contacts to the campaign.
    throw new Error('Not implemented');
  }

  /**
   * THE CENTERPIECE.
   *
   * 1. Load the campaign + the contact (both must belong to userId).
   * 2. Interpolate the contact's fields into campaign.promptTemplate.
   * 3. Set status PENDING, call this.llm.complete(...), persist the result.
   * 4. On success -> FINISHED + generatedMessage. On any error -> FAILED + error.
   *
   * Think about: provider errors, timeouts, a template referencing a missing field,
   * and what happens if this is called twice for the same contact.
   */
  async generateForContact(
    userId: string,
    campaignId: string,
    contactId: string,
  ): Promise<{ status: string; message?: string; error?: string }> {
    // TODO(candidate): implement. Do not let a provider error throw an unhandled
    // 500 — record FAILED and return a sensible shape.
    throw new Error('Not implemented');
  }
}
