import { request } from './api';
import { Contact } from './contacts';

/**
 * Campaign service layer for create, attach, read, launch, and generate calls.
 */

export interface CampaignContact {
  contactId: string;
  contact?: Contact;
  status: 'not_generated' | 'pending' | 'finished' | 'failed';
  generatedMessage?: string;
  error?: string;
}

export interface SequenceStep {
  stepId?: string;
  order: number;
  delayMinutes: number;
  subjectTemplate: string;
  promptTemplate: string;
}

export interface CampaignRecipient {
  _id: string;
  campaignId: string;
  contactId: string;
  sourceGroupIds: string[];
  direct: boolean;
  snapshot: {
    name: string;
    email: string;
    company?: string;
    title?: string;
  };
}

export interface Campaign {
  _id: string;
  name: string;
  status?: 'draft' | 'launching' | 'running' | 'completed';
  promptTemplate?: string;
  targetGroupIds: string[];
  directContactIds: string[];
  sequenceSteps: SequenceStep[];
  contacts: CampaignContact[];
  recipients?: CampaignRecipient[];
  launchedAt?: string;
  completedAt?: string;
}

export interface OutboxMessage {
  _id: string;
  campaignId: string;
  contactId: string;
  stepId: string;
  stepOrder: number;
  dedupeKey: string;
  recipient: {
    name: string;
    email: string;
    company?: string;
    title?: string;
  };
  subject?: string;
  body?: string;
  status: 'queued' | 'processing' | 'sent' | 'failed';
  scheduledFor?: string;
  sentAt?: string;
  attempts: number;
  error?: string;
}

export interface CreateCampaignBody {
  name: string;
  promptTemplate?: string;
  groupIds?: string[];
  contactIds?: string[];
  sequenceSteps?: SequenceStep[];
}

export const campaignsApi = {
  list(): Promise<Campaign[]> {
    return request<Campaign[]>('/campaigns');
  },

  create(body: CreateCampaignBody): Promise<Campaign> {
    return request<Campaign>('/campaigns', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  update(id: string, body: Partial<CreateCampaignBody>): Promise<Campaign> {
    return request<Campaign>(`/campaigns/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  getOne(id: string): Promise<Campaign> {
    return request<Campaign>(`/campaigns/${id}`);
  },

  launch(id: string): Promise<Campaign> {
    return request<Campaign>(`/campaigns/${id}/launch`, {
      method: 'POST',
    });
  },

  getOutbox(id: string): Promise<OutboxMessage[]> {
    return request<OutboxMessage[]>(`/campaigns/${id}/outbox`);
  },

  generate(
    campaignId: string,
    contactId: string,
  ): Promise<{ status: string; message?: string; error?: string }> {
    return request(`/campaigns/${campaignId}/contacts/${contactId}/generate`, {
      method: 'POST',
    });
  },
};
