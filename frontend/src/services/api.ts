/**
 * Tiny fetch wrapper — your single point for talking to the API.
 *
 * It injects the `x-user-id` header (our auth stand-in) and normalizes errors into
 * an `ApiError`. Build your typed service functions (contacts, campaigns) on top of
 * `request()`. Components should call those services via hooks — not fetch directly.
 *
 * (Mirrors the service-layer + interceptor pattern in our real frontend.)
 */
const BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token =
    typeof window !== 'undefined' ? window.localStorage.getItem('authToken') : '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string> | undefined) || {}),
  };
  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: 'Request failed' }));
    throw new ApiError(res.status, body.message || 'Request failed');
  }

  // Some endpoints may return empty bodies.
  return res.status === 204 ? (undefined as T) : res.json();
}

export interface Contact {
  id: string;
  name: string;
  email: string;
  company: string;
  title: string;
  suppressed: boolean;
  createdAt: string;
}

export interface Group {
  id: string;
  name: string;
  description: string;
  contactIds: string[];
  createdAt: string;
  memberCount: number;
}

export interface GroupDetail extends Group {
  members: Contact[];
}

export interface SequenceStep {
  stepId?: string;
  order: number;
  delayMinutes: number;
  subjectTemplate: string;
  promptTemplate: string;
}

export interface RecipientSnapshot {
  id: string;
  name: string;
  email: string;
  company: string;
  title: string;
  source: string;
}

export interface CampaignAttachedContact {
  contactId: string;
  contact: Contact | null;
  status: 'not_generated' | 'pending' | 'finished' | 'failed';
  generatedMessage: string | null;
  error: string | null;
}

export interface Campaign {
  id: string;
  name: string;
  status: 'draft' | 'generating' | 'launching' | 'running' | 'completed' | 'failed';
  generationError: string | null;
  canRetryGeneration?: boolean;
  targetGroupIds: string[];
  targetContactIds: string[];
  sequenceSteps: SequenceStep[];
  contacts: CampaignAttachedContact[];
  recipients: RecipientSnapshot[];
  createdAt: string;
}

export interface OutboxRow {
  id: string;
  campaignId: string;
  contactId: string;
  recipientName: string;
  recipientEmail: string;
  stepOrder: number;
  status: 'queued' | 'processing' | 'sent' | 'failed';
  subject: string;
  message: string;
  error: string | null;
  attempts: number;
  scheduledAt: string;
  sentAt: string | null;
}

export interface ContactGeneration {
  status: 'idle' | 'generating' | 'completed' | 'failed';
  message: string;
  error: string | null;
}

export interface CampaignOutboxData {
  outbox: OutboxRow[];
  generations: Record<string, ContactGeneration>;
}

export interface GenerationRecoveryDebugResult {
  recovery: {
    scanned: number;
    requeued: number;
    failed: number;
  };
  campaign: Campaign;
}

export interface IdempotencyOptions {
  idempotencyKey?: string;
}

export interface CampaignTemplate {
  id: string;
  key: string;
  name: string;
  description: string;
  defaultMaxSteps: number;
  steps: Array<{
    order: number;
    delayDays: number;
    subjectTemplate: string;
    promptTemplate: string;
  }>;
}

export const contactsService = {
  async getAll(search = '', page = 1, limit = 10): Promise<{
    contacts: Contact[];
    totalCount: number;
    pageCount: number;
    page: number;
  }> {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      sort: 'name',
    });
    if (search) {
      params.set('search', search);
    }
    const res = await request<{
      items: BackendContact[];
      total: number;
      page: number;
      limit: number;
    }>(`/contacts?${params.toString()}`);

    return {
      contacts: res.items.map(mapContact),
      totalCount: res.total,
      pageCount: Math.max(1, Math.ceil(res.total / res.limit)),
      page: res.page,
    };
  },

  async create(data: {
    name: string;
    email: string;
    company?: string;
    title?: string;
    suppressed?: boolean;
  }): Promise<Contact> {
    const contact = await request<BackendContact>('/contacts', {
      method: 'POST',
      body: JSON.stringify({
        name: data.name,
        email: data.email,
        company: data.company || undefined,
        title: data.title || undefined,
        doNotContact: Boolean(data.suppressed),
      }),
    });
    return mapContact(contact);
  },
};

export const groupsService = {
  async getAll(): Promise<Group[]> {
    const groups = await request<BackendGroup[]>('/groups');
    const details = await Promise.all(
      groups.map((group) =>
        request<BackendGroupDetail>(`/groups/${group._id}`).catch(() => null),
      ),
    );

    return groups.map((group, index) =>
      mapGroup(group, details[index]?.contacts || []),
    );
  },

  async create(data: { name: string; description?: string }): Promise<Group> {
    const group = await request<BackendGroup>('/groups', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return mapGroup(group, []);
  },

  async getById(id: string): Promise<GroupDetail> {
    const group = await request<BackendGroupDetail>(`/groups/${id}`);
    return mapGroupDetail(group);
  },

  async addContact(
    groupId: string,
    contactId: string,
  ): Promise<{ success: boolean; contact: Contact; memberCount: number }> {
    const group = await request<BackendGroupDetail>(`/groups/${groupId}/contacts`, {
      method: 'POST',
      body: JSON.stringify({ contactIds: [contactId] }),
    });
    const added = (group.contacts || []).find(
      (contact) => contact._id === contactId,
    );
    return {
      success: true,
      contact: mapContact(added || group.contacts[0]),
      memberCount: group.memberCount ?? group.contacts.length,
    };
  },

  async removeContact(
    groupId: string,
    contactId: string,
  ): Promise<{ success: boolean; memberCount: number }> {
    const group = await request<BackendGroupDetail>(
      `/groups/${groupId}/contacts/${contactId}`,
      { method: 'DELETE' },
    );
    return { success: true, memberCount: group.memberCount ?? group.contacts.length };
  },
};

export const campaignsService = {
  async getTemplates(): Promise<CampaignTemplate[]> {
    const templates = await request<BackendCampaignTemplate[]>('/campaign-templates');
    return templates.map(mapCampaignTemplate);
  },

  async getAll(): Promise<Campaign[]> {
    const campaigns = await request<BackendCampaign[]>('/campaigns');
    const hydrated = await Promise.all(
      campaigns.map(async (campaign) => {
        if ((campaign.status || 'draft') === 'draft') {
          return campaign;
        }
        return request<BackendCampaign>(`/campaigns/${campaign._id}`).catch(
          () => campaign,
        );
      }),
    );
    return hydrated.map(mapCampaign);
  },

  async create(data: {
    name: string;
    promptTemplate?: string;
    targetGroupIds?: string[];
    targetContactIds?: string[];
    sequenceSteps?: SequenceStep[];
  }, options: IdempotencyOptions = {}): Promise<Campaign> {
    const steps = data.sequenceSteps?.length
      ? normalizeSteps(data.sequenceSteps)
      : undefined;
    const campaign = await request<BackendCampaign>('/campaigns', {
      method: 'POST',
      headers: idempotencyHeaders(options.idempotencyKey),
      body: JSON.stringify({
        name: data.name,
        promptTemplate: data.promptTemplate || steps?.[0]?.promptTemplate,
        groupIds: data.targetGroupIds || [],
        contactIds: data.targetContactIds || [],
        sequenceSteps: steps,
      }),
    });
    return mapCampaign(campaign);
  },

  async attachContacts(campaignId: string, contactIds: string[]): Promise<Campaign> {
    const campaign = await request<BackendCampaign>(
      `/campaigns/${campaignId}/contacts`,
      {
        method: 'POST',
        body: JSON.stringify({ contactIds }),
      },
    );
    return mapCampaign(campaign);
  },

  async generateSequence(campaignId: string): Promise<Campaign> {
    const campaign = await request<BackendCampaign>(
      `/campaigns/${campaignId}/generate-sequence`,
      { method: 'POST' },
    );
    return mapCampaign(campaign);
  },

  async retryGeneration(campaignId: string): Promise<Campaign> {
    const campaign = await request<BackendCampaign>(
      `/campaigns/${campaignId}/retry-generation`,
      { method: 'POST' },
    );
    return mapCampaign(campaign);
  },

  async debugSimulateGenerationWorkerCrash(
    campaignId: string,
  ): Promise<Campaign> {
    const campaign = await request<BackendCampaign>(
      `/campaigns/${campaignId}/debug/simulate-generation-worker-crash`,
      { method: 'POST' },
    );
    return mapCampaign(campaign);
  },

  async debugRecoverGeneration(
    campaignId: string,
  ): Promise<GenerationRecoveryDebugResult> {
    const result = await request<{
      recovery: GenerationRecoveryDebugResult['recovery'];
      campaign: BackendCampaign;
    }>(`/campaigns/${campaignId}/debug/recover-generation`, {
      method: 'POST',
    });
    return {
      recovery: result.recovery,
      campaign: mapCampaign(result.campaign),
    };
  },

  async updateSequenceStep(
    campaignId: string,
    stepId: string,
    data: Partial<SequenceStep>,
  ): Promise<Campaign> {
    const campaign = await request<BackendCampaign>(
      `/campaigns/${campaignId}/sequence-steps/${encodeURIComponent(stepId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          delayMinutes: data.delayMinutes,
          subjectTemplate: data.subjectTemplate,
          promptTemplate: data.promptTemplate,
        }),
      },
    );
    return mapCampaign(campaign);
  },

  async regenerateSequenceStep(
    campaignId: string,
    stepId: string,
    instructions?: string,
  ): Promise<SequenceStep> {
    const result = await request<{ step: SequenceStep }>(
      `/campaigns/${campaignId}/sequence-steps/${encodeURIComponent(stepId)}/regenerate`,
      {
        method: 'POST',
        body: JSON.stringify({ instructions: instructions || undefined }),
      },
    );
    return result.step;
  },

  async delete(id: string): Promise<{ success: boolean }> {
    return request<{ success: boolean }>(`/campaigns/${id}`, {
      method: 'DELETE',
    });
  },

  async generateDraft(data: {
    name: string;
    goal: string;
    audienceDescription: string;
    templateId: string;
    tone?: string;
    maxSteps?: number;
    targetGroupIds: string[];
    targetContactIds: string[];
  }, options: IdempotencyOptions = {}): Promise<Campaign> {
    const campaign = await request<BackendCampaign>('/campaigns/generate-draft', {
      method: 'POST',
      headers: idempotencyHeaders(options.idempotencyKey),
      body: JSON.stringify({
        name: data.name,
        goal: data.goal,
        audienceDescription: data.audienceDescription,
        templateId: data.templateId,
        tone: data.tone || undefined,
        maxSteps: data.maxSteps,
        groupIds: data.targetGroupIds,
        contactIds: data.targetContactIds,
      }),
    });
    return mapCampaign(campaign);
  },

  async getById(id: string): Promise<Campaign> {
    return mapCampaign(await request<BackendCampaign>(`/campaigns/${id}`));
  },

  async launch(id: string): Promise<{ success: boolean; campaign: Campaign }> {
    const campaign = await request<BackendCampaign>(`/campaigns/${id}/launch`, {
      method: 'POST',
    });
    return { success: true, campaign: mapCampaign(campaign) };
  },

  async getOutbox(id: string): Promise<CampaignOutboxData> {
    const rows = await request<BackendOutboxRow[]>(`/campaigns/${id}/outbox`);
    const outbox = rows.map(mapOutboxRow);
    const generations: Record<string, ContactGeneration> = {};
    for (const row of outbox) {
      const key = `${row.campaignId}:${row.contactId}`;
      if (row.status === 'sent') {
        generations[key] = {
          status: 'completed',
          message: row.message,
          error: null,
        };
      } else if (row.status === 'failed') {
        generations[key] = {
          status: 'failed',
          message: '',
          error: row.error,
        };
      }
    }
    return { outbox, generations };
  },

  async generateForContact(
    campaignId: string,
    contactId: string,
  ): Promise<{
    success: boolean;
    generation: ContactGeneration;
    usedRealAPI: boolean;
  }> {
    const outbox = await campaignsService.getOutbox(campaignId);
    const pendingRow = outbox.outbox.find(
      (entry) =>
        entry.contactId === contactId &&
        (entry.status === 'queued' || entry.status === 'failed'),
    );
    if (!pendingRow) {
      const sentRow = outbox.outbox
        .filter((entry) => entry.contactId === contactId && entry.status === 'sent')
        .sort((a, b) => b.stepOrder - a.stepOrder)[0];
      if (sentRow) {
        return {
          success: true,
          usedRealAPI: true,
          generation: {
            status: 'completed',
            message: sentRow.message,
            error: null,
          },
        };
      }
    }

    const result = await request<{
      status: string;
      message?: string;
      error?: string;
    }>(`/campaigns/${campaignId}/contacts/${contactId}/generate`, {
      method: 'POST',
    });

    if (result.status === 'pending') {
      return {
        success: true,
        usedRealAPI: true,
        generation: {
          status: 'generating',
          message: '',
          error: null,
        },
      };
    }

    return {
      success: result.status === 'finished',
      usedRealAPI: true,
      generation: {
        status: result.status === 'finished' ? 'completed' : 'failed',
        message: result.message || '',
        error: result.error || null,
      },
    };
  },
};

function idempotencyHeaders(idempotencyKey?: string) {
  return idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined;
}

interface BackendContact {
  _id: string;
  name: string;
  email: string;
  company?: string;
  title?: string;
  doNotContact?: boolean;
  createdAt?: string;
}

interface BackendGroup {
  _id: string;
  name: string;
  description?: string;
  memberCount?: number;
  createdAt?: string;
}

interface BackendGroupDetail extends BackendGroup {
  contacts: BackendContact[];
}

interface BackendRecipient {
  _id: string;
  contactId: string;
  direct?: boolean;
  snapshot: {
    name: string;
    email: string;
    company?: string;
    title?: string;
  };
}

interface BackendCampaignContact {
  contactId: string;
  contact?: BackendContact;
  status?: CampaignAttachedContact['status'];
  generatedMessage?: string;
  error?: string;
}

interface BackendCampaign {
  _id: string;
  name: string;
  status?: Campaign['status'];
  generationError?: string;
  canRetryGeneration?: boolean;
  promptTemplate?: string;
  targetGroupIds?: string[];
  directContactIds?: string[];
  sequenceSteps?: SequenceStep[];
  contacts?: BackendCampaignContact[];
  recipients?: BackendRecipient[];
  createdAt?: string;
}

interface BackendCampaignTemplate {
  _id: string;
  id?: string;
  key: string;
  name: string;
  description?: string;
  defaultMaxSteps?: number;
  steps?: CampaignTemplate['steps'];
}

interface BackendOutboxRow {
  _id: string;
  campaignId: string;
  contactId: string;
  stepOrder: number;
  status: OutboxRow['status'];
  subject?: string;
  body?: string;
  error?: string;
  attempts?: number;
  scheduledFor?: string;
  sentAt?: string;
  recipient: {
    name: string;
    email: string;
  };
}

function mapContact(contact: BackendContact): Contact {
  return {
    id: contact._id,
    name: contact.name,
    email: contact.email,
    company: contact.company || '',
    title: contact.title || '',
    suppressed: Boolean(contact.doNotContact),
    createdAt: contact.createdAt || new Date().toISOString(),
  };
}

function mapGroup(group: BackendGroup, contacts: BackendContact[]): Group {
  return {
    id: group._id,
    name: group.name,
    description: group.description || '',
    contactIds: contacts.map((contact) => contact._id),
    createdAt: group.createdAt || new Date().toISOString(),
    memberCount: group.memberCount ?? contacts.length,
  };
}

function mapGroupDetail(group: BackendGroupDetail): GroupDetail {
  return {
    ...mapGroup(group, group.contacts || []),
    members: (group.contacts || []).map(mapContact),
  };
}

function mapCampaign(campaign: BackendCampaign): Campaign {
  return {
    id: campaign._id,
    name: campaign.name,
    status: campaign.status || 'draft',
    generationError: campaign.generationError || null,
    canRetryGeneration: Boolean(campaign.canRetryGeneration),
    targetGroupIds: campaign.targetGroupIds || [],
    targetContactIds: campaign.directContactIds || [],
    sequenceSteps: campaign.sequenceSteps || [],
    contacts: (campaign.contacts || []).map((entry) => ({
      contactId: entry.contactId,
      contact: entry.contact ? mapContact(entry.contact) : null,
      status: entry.status || 'not_generated',
      generatedMessage: entry.generatedMessage || null,
      error: entry.error || null,
    })),
    recipients: (campaign.recipients || []).map((recipient) => ({
      id: recipient.contactId,
      name: recipient.snapshot.name,
      email: recipient.snapshot.email,
      company: recipient.snapshot.company || '',
      title: recipient.snapshot.title || '',
      source: recipient.direct ? 'Direct' : 'Group',
    })),
    createdAt: campaign.createdAt || new Date().toISOString(),
  };
}

function mapOutboxRow(row: BackendOutboxRow): OutboxRow {
  return {
    id: row._id,
    campaignId: row.campaignId,
    contactId: row.contactId,
    recipientName: row.recipient.name,
    recipientEmail: row.recipient.email,
    stepOrder: row.stepOrder,
    status: row.status,
    subject: row.subject || '',
    message: row.body || '',
    error: row.error || null,
    attempts: row.attempts || 0,
    scheduledAt: row.scheduledFor || new Date().toISOString(),
    sentAt: row.sentAt || null,
  };
}

function mapCampaignTemplate(template: BackendCampaignTemplate): CampaignTemplate {
  return {
    id: template.id || template._id,
    key: template.key,
    name: template.name,
    description: template.description || '',
    defaultMaxSteps: template.defaultMaxSteps || 1,
    steps: template.steps || [],
  };
}

function normalizeSteps(steps: SequenceStep[]): SequenceStep[] {
  return steps.map((step, index) => ({
    ...step,
    stepId: `step-${index + 1}`,
    order: index + 1,
    subjectTemplate: normalizeTemplate(step.subjectTemplate),
    promptTemplate: normalizeTemplate(step.promptTemplate),
  }));
}

function normalizeTemplate(value: string) {
  return value
    .replaceAll('${contactName}', '{{name}}')
    .replaceAll('${contactEmail}', '{{email}}')
    .replaceAll('${contactCompany}', '{{company}}')
    .replaceAll('${contactTitle}', '{{title}}');
}
