import { request } from './api';

/**
 * STARTER service layer for campaigns. Extend with what your pages need
 * (create campaign, attach contacts, generate message).
 */

export interface CampaignContact {
  contactId: string;
  status: 'not_generated' | 'pending' | 'finished' | 'failed';
  generatedMessage?: string;
  error?: string;
}

export interface Campaign {
  _id: string;
  name: string;
  promptTemplate: string;
  contacts: CampaignContact[];
}

export const campaignsApi = {
  getOne(id: string): Promise<Campaign> {
    return request<Campaign>(`/campaigns/${id}`);
  },

  generate(
    campaignId: string,
    contactId: string,
  ): Promise<{ status: string; message?: string; error?: string }> {
    return request(`/campaigns/${campaignId}/contacts/${contactId}/generate`, {
      method: 'POST',
    });
  },

  // TODO(candidate): create(), attachContacts(), etc.
};
