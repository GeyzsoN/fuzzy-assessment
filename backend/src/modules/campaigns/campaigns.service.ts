import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Queue } from 'bullmq';
import { Model, Types } from 'mongoose';
import {
  Campaign,
  CampaignDocument,
  CampaignStatus,
  GenerationStatus,
  SequenceStep,
} from './schemas/campaign.schema';
import {
  CampaignRecipient,
  CampaignRecipientDocument,
  RecipientSnapshot,
} from './schemas/campaign-recipient.schema';
import {
  OutboxMessage,
  OutboxMessageDocument,
  OutboxStatus,
} from './schemas/outbox-message.schema';
import {
  CampaignTemplate,
  CampaignTemplateDocument,
  PromptTemplate,
  PromptTemplateDocument,
} from './schemas/campaign-template.schema';
import { CreateCampaignDto } from './dtos/create-campaign.dto';
import { UpdateCampaignDto } from './dtos/update-campaign.dto';
import { AttachContactsDto } from './dtos/attach-contacts.dto';
import { GenerateCampaignDraftDto } from './dtos/generate-campaign-draft.dto';
import {
  CAMPAIGN_GENERATION_JOB,
  CAMPAIGN_GENERATION_QUEUE,
  SEQUENCE_EMAIL_JOB,
  SEQUENCE_EMAIL_QUEUE,
} from './sequence-queue.constants';
import {
  DEFAULT_CAMPAIGN_TEMPLATES,
  DEFAULT_PROMPT_TEMPLATES,
} from './default-campaign-templates';
import {
  buildCampaignDraftPrompt,
  clampMaxSteps,
  hydrateContactPlaceholders,
  normalizeSequenceSteps,
  parseCampaignDraftResponse,
} from './campaign-generation.helpers';
import { ContactsService } from '../contacts/contacts.service';
import { GroupsService } from '../groups/groups.service';
import { LlmService } from '../../shared/llm/llm.service';

type ResolvedRecipient = {
  contactId: string;
  direct: boolean;
  sourceGroupIds: string[];
  snapshot: RecipientSnapshot;
};

@Injectable()
export class CampaignsService implements OnModuleInit {
  constructor(
    @InjectModel(Campaign.name)
    private readonly campaignModel: Model<CampaignDocument>,
    @InjectModel(CampaignRecipient.name)
    private readonly recipientModel: Model<CampaignRecipientDocument>,
    @InjectModel(OutboxMessage.name)
    private readonly outboxModel: Model<OutboxMessageDocument>,
    @InjectModel(CampaignTemplate.name)
    private readonly campaignTemplateModel: Model<CampaignTemplateDocument>,
    @InjectModel(PromptTemplate.name)
    private readonly promptTemplateModel: Model<PromptTemplateDocument>,
    @InjectQueue(SEQUENCE_EMAIL_QUEUE)
    private readonly sequenceQueue: Queue,
    @InjectQueue(CAMPAIGN_GENERATION_QUEUE)
    private readonly campaignGenerationQueue: Queue,
    private readonly contactsService: ContactsService,
    private readonly groupsService: GroupsService,
    private readonly llm: LlmService,
  ) {}

  async onModuleInit() {
    await this.seedManagedTemplates();
  }

  async listTemplates(): Promise<any[]> {
    const templates = await this.campaignTemplateModel
      .find({})
      .sort({ name: 1, _id: 1 })
      .lean()
      .exec();
    return templates.map(serializeCampaignTemplatePlain);
  }

  async generateDraft(
    userId: string,
    dto: GenerateCampaignDraftDto,
  ): Promise<any> {
    await this.validateTargets(userId, dto.groupIds || [], dto.contactIds || []);
    const campaignTemplate = await this.findCampaignTemplate(dto.templateId);
    const promptTemplate = await this.promptTemplateModel
      .findOne({
        key: campaignTemplate.promptTemplateKey || 'sequence-draft-v1',
      })
      .lean()
      .exec();
    if (!promptTemplate) {
      throw new BadRequestException('Campaign generation prompt is not configured');
    }

    const campaign = await this.campaignModel.create({
      userId,
      name: dto.name,
      status: CampaignStatus.GENERATING,
      targetGroupIds: toObjectIds(dto.groupIds || [], 'group'),
      directContactIds: toObjectIds(dto.contactIds || [], 'contact'),
      sequenceSteps: [],
      contacts: makeCampaignContacts(dto.contactIds || []),
    });

    await this.campaignGenerationQueue.add(
      CAMPAIGN_GENERATION_JOB,
      {
        userId,
        campaignId: String(campaign._id),
        dto,
      },
      {
        jobId: makeBullJobId(CAMPAIGN_GENERATION_JOB, String(campaign._id)),
        attempts: 2,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: false,
      },
    );

    return this.serializeCampaign(userId, campaign);
  }

  async processCampaignDraftGeneration(input: {
    userId: string;
    campaignId: string;
    dto: GenerateCampaignDraftDto;
  }): Promise<void> {
    const campaign = await this.requireCampaign(input.userId, input.campaignId);
    if (campaign.status === CampaignStatus.DRAFT) {
      return;
    }
    if (
      campaign.status !== CampaignStatus.GENERATING &&
      campaign.status !== CampaignStatus.FAILED
    ) {
      throw new BadRequestException('Campaign is not pending generation');
    }

    await this.campaignModel.updateOne(
      { _id: campaign._id, userId: input.userId },
      {
        $set: { status: CampaignStatus.GENERATING },
        $unset: { generationError: '' },
      },
    );

    try {
      const campaignTemplate = await this.findCampaignTemplate(input.dto.templateId);
      const promptTemplate = await this.promptTemplateModel
        .findOne({
          key: campaignTemplate.promptTemplateKey || 'sequence-draft-v1',
        })
        .lean()
        .exec();
      if (!promptTemplate) {
        throw new BadRequestException('Campaign generation prompt is not configured');
      }

      const maxSteps = clampMaxSteps(
        input.dto.maxSteps ||
          campaignTemplate.defaultMaxSteps ||
          campaignTemplate.steps.length,
      );
      const prompt = buildCampaignDraftPrompt({
        name: input.dto.name,
        goal: input.dto.goal,
        audienceDescription: input.dto.audienceDescription,
        tone: input.dto.tone,
        maxSteps,
        campaignTemplate,
        promptTemplate,
      });

      const llmResponse = await withTimeout(this.llm.complete(prompt), 20000);
      const sequenceSteps = parseCampaignDraftResponse(llmResponse, maxSteps);

      await this.campaignModel.updateOne(
        { _id: campaign._id, userId: input.userId },
        {
          $set: {
            status: CampaignStatus.DRAFT,
            promptTemplate: sequenceSteps[0]?.promptTemplate,
            sequenceSteps,
            generatedAt: new Date(),
          },
          $unset: { generationError: '' },
        },
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Campaign draft generation failed';
      await this.campaignModel.updateOne(
        { _id: campaign._id, userId: input.userId },
        {
          $set: {
            status: CampaignStatus.FAILED,
            generationError: message,
          },
        },
      );
      throw error;
    }
  }

  async create(userId: string, dto: CreateCampaignDto): Promise<any> {
    await this.validateTargets(userId, dto.groupIds || [], dto.contactIds || []);
    const sequenceSteps = normalizeSequenceSteps(
      dto.sequenceSteps,
      dto.promptTemplate,
    );

    const campaign = await this.campaignModel.create({
      userId,
      name: dto.name,
      status: CampaignStatus.DRAFT,
      promptTemplate: dto.promptTemplate || sequenceSteps[0]?.promptTemplate,
      targetGroupIds: toObjectIds(dto.groupIds || [], 'group'),
      directContactIds: toObjectIds(dto.contactIds || [], 'contact'),
      sequenceSteps,
      contacts: makeCampaignContacts(dto.contactIds || []),
    });

    return this.serializeCampaign(userId, campaign);
  }

  async update(
    userId: string,
    campaignId: string,
    dto: UpdateCampaignDto,
  ): Promise<any> {
    const campaign = await this.requireCampaign(userId, campaignId);
    if (campaign.status && campaign.status !== CampaignStatus.DRAFT) {
      throw new BadRequestException('Only draft campaigns can be edited');
    }

    await this.validateTargets(userId, dto.groupIds || [], dto.contactIds || []);

    if (dto.name !== undefined) {
      campaign.name = dto.name;
    }
    if (dto.promptTemplate !== undefined) {
      campaign.promptTemplate = dto.promptTemplate;
    }
    if (dto.groupIds !== undefined) {
      campaign.targetGroupIds = toObjectIds(dto.groupIds, 'group');
    }
    if (dto.contactIds !== undefined) {
      campaign.directContactIds = toObjectIds(dto.contactIds, 'contact');
    }
    if (dto.sequenceSteps !== undefined || dto.promptTemplate !== undefined) {
      campaign.sequenceSteps = normalizeSequenceSteps(
        dto.sequenceSteps || campaign.sequenceSteps,
        campaign.promptTemplate,
      );
    }

    await campaign.save();
    return this.serializeCampaign(userId, campaign);
  }

  async list(userId: string): Promise<any[]> {
    const campaigns = await this.campaignModel
      .find({ userId })
      .sort({ createdAt: -1, _id: 1 })
      .lean()
      .exec();
    return campaigns.map((campaign: any) => serializeCampaignPlain(campaign));
  }

  async getOne(userId: string, campaignId: string): Promise<any> {
    const campaign = await this.requireCampaign(userId, campaignId);
    return this.serializeCampaign(userId, campaign);
  }

  async remove(
    userId: string,
    campaignId: string,
  ): Promise<{ success: boolean }> {
    const campaign = await this.requireCampaign(userId, campaignId);
    const outboxRows = await this.outboxModel
      .find({
        userId,
        campaignId: campaign._id,
      })
      .select('dedupeKey')
      .lean()
      .exec();

    await Promise.all(
      outboxRows
        .map((row: any) => row.dedupeKey)
        .filter(Boolean)
        .map((dedupeKey: string) =>
          this.sequenceQueue
            .remove(makeBullJobId(...dedupeKey.split(':')))
            .catch(() => undefined),
        ),
    );

    await Promise.all([
      this.outboxModel.deleteMany({ userId, campaignId: campaign._id }).exec(),
      this.recipientModel.deleteMany({ userId, campaignId: campaign._id }).exec(),
      this.campaignModel.deleteOne({ _id: campaign._id, userId }).exec(),
    ]);

    return { success: true };
  }

  async attachContacts(
    userId: string,
    campaignId: string,
    dto: AttachContactsDto,
  ): Promise<any> {
    const campaign = await this.requireCampaign(userId, campaignId);
    if (campaign.status && campaign.status !== CampaignStatus.DRAFT) {
      throw new BadRequestException('Only draft campaigns can be edited');
    }

    const contacts = await this.contactsService.findOwnedByIds(
      userId,
      dto.contactIds,
    );
    if (contacts.length !== new Set(dto.contactIds).size) {
      throw new BadRequestException('One or more contacts were not found');
    }

    const existing = new Set(
      campaign.contacts.map((entry) => String(entry.contactId)),
    );
    const direct = new Set(
      (campaign.directContactIds || []).map((id) => String(id)),
    );
    contacts.forEach((contact: any) => {
      const id = String(contact._id);
      if (!existing.has(id)) {
        campaign.contacts.push({
          contactId: contact._id,
          status: GenerationStatus.NOT_GENERATED,
        });
      }
      direct.add(id);
    });

    campaign.directContactIds = [...direct].map((id) => new Types.ObjectId(id));
    await campaign.save();
    return this.serializeCampaign(userId, campaign);
  }

  async launch(userId: string, campaignId: string): Promise<any> {
    const campaign = await this.requireCampaign(userId, campaignId);
    if (campaign.status && campaign.status !== CampaignStatus.DRAFT) {
      throw new BadRequestException('Campaign has already been launched');
    }

    const sequenceSteps = normalizeSequenceSteps(
      campaign.sequenceSteps,
      campaign.promptTemplate,
    );
    const recipients = await this.resolveRecipients(userId, campaign);
    if (!recipients.length) {
      throw new BadRequestException(
        'Campaign has no eligible recipients after dedupe and suppression',
      );
    }

    const claimed = await this.campaignModel.findOneAndUpdate(
      {
        _id: campaign._id,
        userId,
        $or: [
          { status: CampaignStatus.DRAFT },
          { status: { $exists: false } },
        ],
      },
      {
        $set: {
          status: CampaignStatus.LAUNCHING,
          launchedAt: new Date(),
          sequenceSteps,
        },
      },
      { new: true },
    );
    if (!claimed) {
      throw new BadRequestException('Campaign has already been launched');
    }

    await this.snapshotRecipients(userId, claimed, recipients);
    const firstStep = sequenceSteps[0];
    for (const recipient of recipients) {
      await this.scheduleOutboxForStep(userId, claimed, recipient, firstStep);
    }

    claimed.status = CampaignStatus.RUNNING;
    await claimed.save();
    return this.serializeCampaign(userId, claimed);
  }

  async generateSequence(userId: string, campaignId: string): Promise<any> {
    const campaign = await this.requireCampaign(userId, campaignId);
    if (campaign.status === CampaignStatus.GENERATING) {
      return this.serializeCampaign(userId, campaign);
    }
    if (
      campaign.status !== CampaignStatus.DRAFT &&
      campaign.status !== CampaignStatus.FAILED
    ) {
      throw new BadRequestException('Only draft campaigns can generate a sequence');
    }

    const campaignTemplate = await this.findDefaultCampaignTemplate();
    const goal =
      campaign.promptTemplate ||
      campaign.sequenceSteps?.[0]?.promptTemplate ||
      campaign.name;
    const groupIds = (campaign.targetGroupIds || []).map((id) => String(id));
    const contactIds = [
      ...new Set([
        ...(campaign.directContactIds || []).map((id) => String(id)),
        ...(campaign.contacts || []).map((entry) => String(entry.contactId)),
      ]),
    ];

    if (!groupIds.length && !contactIds.length) {
      throw new BadRequestException(
        'Select at least one group or contact before generating a sequence',
      );
    }

    const requestedSteps = inferRequestedStepCount(goal);
    const maxSteps = clampMaxSteps(
      requestedSteps || Math.min(campaignTemplate.defaultMaxSteps || 3, 3),
    );
    const dto: GenerateCampaignDraftDto = {
      name: campaign.name,
      goal,
      audienceDescription:
        'Selected campaign audience. Keep contact values as placeholders.',
      templateId: String(campaignTemplate._id),
      tone: 'warm and direct',
      maxSteps,
      groupIds,
      contactIds,
    };

    await this.campaignModel.updateOne(
      { _id: campaign._id, userId },
      {
        $set: {
          status: CampaignStatus.GENERATING,
          targetGroupIds: toObjectIds(groupIds, 'group'),
          directContactIds: toObjectIds(contactIds, 'contact'),
          sequenceSteps: [],
        },
        $unset: { generationError: '' },
      },
    );

    await this.campaignGenerationQueue.add(
      CAMPAIGN_GENERATION_JOB,
      { userId, campaignId: String(campaign._id), dto },
      {
        jobId: makeBullJobId(CAMPAIGN_GENERATION_JOB, String(campaign._id)),
        attempts: 2,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: false,
      },
    );

    const updated = await this.requireCampaign(userId, campaignId);
    return this.serializeCampaign(userId, updated);
  }

  async getOutbox(userId: string, campaignId: string): Promise<any[]> {
    await this.requireCampaign(userId, campaignId);
    const rows = await this.outboxModel
      .find({ userId, campaignId: new Types.ObjectId(campaignId) })
      .sort({ stepOrder: 1, createdAt: 1, _id: 1 })
      .lean()
      .exec();
    return rows.map((row: any) => serializeOutboxPlain(row));
  }

  /**
   * Original take-home endpoint: generate one personalized opener for a single
   * attached contact and persist status on the embedded campaign contact.
   */
  async generateForContact(
    userId: string,
    campaignId: string,
    contactId: string,
  ): Promise<{ status: string; message?: string; error?: string }> {
    const campaign = await this.requireCampaign(userId, campaignId);
    const [contact] = await this.contactsService.findOwnedByIds(userId, [
      contactId,
    ]);
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    const outboxContactId = new Types.ObjectId(contactId);
    const outboxBaseFilter = {
      userId,
      campaignId: campaign._id,
      contactId: outboxContactId,
    };
    const actionableOutbox = await this.outboxModel
      .findOne({
        ...outboxBaseFilter,
        status: { $in: [OutboxStatus.QUEUED, OutboxStatus.FAILED] },
      })
      .sort({ stepOrder: 1, scheduledFor: 1, _id: 1 })
      .lean()
      .exec();

    if (actionableOutbox) {
      try {
        await this.processOutboxMessage(String(actionableOutbox._id));
      } catch {
        // The worker path rethrows for queue retry semantics. For the HTTP
        // generate action, return the persisted outbox failure state below.
      }
      const updated = await this.outboxModel
        .findById(actionableOutbox._id)
        .lean()
        .exec();

      if (updated?.status === OutboxStatus.SENT) {
        return { status: GenerationStatus.FINISHED, message: updated.body };
      }

      return {
        status: GenerationStatus.FAILED,
        error: updated?.error || 'Outbox email generation failed',
      };
    }

    const processingOutbox = await this.outboxModel
      .findOne({
        ...outboxBaseFilter,
        status: OutboxStatus.PROCESSING,
      })
      .sort({ stepOrder: 1, scheduledFor: 1, _id: 1 })
      .lean()
      .exec();
    if (processingOutbox) {
      return { status: GenerationStatus.PENDING };
    }

    const sentOutbox = await this.outboxModel
      .findOne({
        ...outboxBaseFilter,
        status: OutboxStatus.SENT,
      })
      .sort({ stepOrder: -1, sentAt: -1, _id: -1 })
      .lean()
      .exec();
    if (sentOutbox) {
      return { status: GenerationStatus.FINISHED, message: sentOutbox.body };
    }

    const entry = campaign.contacts.find(
      (campaignContact) => String(campaignContact.contactId) === contactId,
    );
    if (!entry) {
      throw new BadRequestException('Contact is not attached to this campaign');
    }

    entry.status = GenerationStatus.PENDING;
    entry.error = undefined;
    await campaign.save();

    try {
      const template =
        campaign.promptTemplate || campaign.sequenceSteps?.[0]?.promptTemplate;
      if (!template) {
        throw new BadRequestException('Campaign has no prompt template');
      }
      const prompt = hydrateContactPlaceholders(template, contact as any, {
        requirePlaceholder: true,
      });
      const llmOutput = await withTimeout(this.llm.complete(prompt), 12000);
      const message = (llmOutput || '').trim();
      if (!message) {
        throw new BadRequestException('LLM returned an empty message');
      }

      entry.status = GenerationStatus.FINISHED;
      entry.generatedMessage = message;
      entry.error = undefined;
      await campaign.save();

      return { status: entry.status, message };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Message generation failed';
      entry.status = GenerationStatus.FAILED;
      entry.error = message;
      await campaign.save();

      return { status: entry.status, error: message };
    }
  }

  async processOutboxMessage(outboxId: string): Promise<void> {
    if (!Types.ObjectId.isValid(outboxId)) {
      throw new BadRequestException('Invalid outbox id');
    }

    const current = await this.outboxModel.findById(outboxId).lean().exec();
    if (!current || current.status === OutboxStatus.SENT) {
      return;
    }

    const claimed = await this.outboxModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(outboxId),
        status: { $in: [OutboxStatus.QUEUED, OutboxStatus.FAILED] },
      },
      {
        $set: {
          status: OutboxStatus.PROCESSING,
          lockedAt: new Date(),
          error: undefined,
        },
        $inc: { attempts: 1 },
      },
      { new: true },
    );
    if (!claimed) {
      return;
    }

    try {
      const campaign = await this.requireCampaign(
        claimed.userId,
        String(claimed.campaignId),
      );
      const steps = normalizeSequenceSteps(
        campaign.sequenceSteps,
        campaign.promptTemplate,
      );
      const step = steps.find((entry) => entry.stepId === claimed.stepId);
      if (!step) {
        throw new BadRequestException('Sequence step no longer exists');
      }

      const subject = hydrateContactPlaceholders(
        step.subjectTemplate,
        claimed.recipient as any,
        { requirePlaceholder: false },
      );
      const body = hydrateContactPlaceholders(
        step.promptTemplate,
        claimed.recipient as any,
        { requirePlaceholder: true },
      );

      const nextStep = steps.find((entry) => entry.order === step.order + 1);
      if (nextStep) {
        await this.scheduleOutboxForStep(
          claimed.userId,
          campaign,
          {
            contactId: String(claimed.contactId),
            direct: false,
            sourceGroupIds: [],
            snapshot: claimed.recipient,
          },
          nextStep,
        );
      }

      await this.outboxModel.updateOne(
        { _id: claimed._id },
        {
          $set: {
            status: OutboxStatus.SENT,
            subject,
            body,
            sentAt: new Date(),
          },
          $unset: { error: '', lockedAt: '' },
        },
      );
      await this.markCampaignCompleteIfDone(claimed.userId, String(campaign._id));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Outbox processing failed';
      await this.outboxModel.updateOne(
        { _id: claimed._id },
        {
          $set: {
            status: OutboxStatus.FAILED,
            error: message,
          },
          $unset: { lockedAt: '' },
        },
      );
      throw error;
    }
  }

  private async requireCampaign(userId: string, campaignId: string) {
    if (!Types.ObjectId.isValid(campaignId)) {
      throw new BadRequestException('Invalid campaign id');
    }

    const campaign = await this.campaignModel.findOne({
      _id: campaignId,
      userId,
    });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    return campaign;
  }

  private async findCampaignTemplate(templateId: string) {
    const filter = Types.ObjectId.isValid(templateId)
      ? { $or: [{ _id: new Types.ObjectId(templateId) }, { key: templateId }] }
      : { key: templateId };
    const template = await this.campaignTemplateModel.findOne(filter).lean().exec();
    if (!template) {
      throw new BadRequestException('Campaign template not found');
    }
    return template;
  }

  private async findDefaultCampaignTemplate() {
    const template = await this.campaignTemplateModel
      .findOne({ key: 'cold-intro' })
      .lean()
      .exec();
    if (template) {
      return template;
    }

    const fallback = await this.campaignTemplateModel
      .findOne({})
      .sort({ name: 1, _id: 1 })
      .lean()
      .exec();
    if (!fallback) {
      throw new BadRequestException('Campaign template not found');
    }
    return fallback;
  }

  private async seedManagedTemplates() {
    await Promise.all([
      ...DEFAULT_PROMPT_TEMPLATES.map((template) =>
        this.promptTemplateModel.updateOne(
          { key: template.key },
          { $set: template },
          { upsert: true },
        ),
      ),
      ...DEFAULT_CAMPAIGN_TEMPLATES.map((template) =>
        this.campaignTemplateModel.updateOne(
          { key: template.key },
          { $set: template },
          { upsert: true },
        ),
      ),
    ]);
  }

  private async validateTargets(
    userId: string,
    groupIds: string[],
    contactIds: string[],
  ) {
    if (groupIds.length) {
      await this.groupsService.findMembershipsForGroups(userId, groupIds);
    }
    if (contactIds.length) {
      const contacts = await this.contactsService.findOwnedByIds(
        userId,
        contactIds,
      );
      if (contacts.length !== new Set(contactIds).size) {
        throw new BadRequestException('One or more contacts were not found');
      }
    }
  }

  private async resolveRecipients(
    userId: string,
    campaign: CampaignDocument,
  ): Promise<ResolvedRecipient[]> {
    const recipients = new Map<string, ResolvedRecipient>();
    const groupIds = (campaign.targetGroupIds || []).map((id) => String(id));
    const directIds = new Set(
      (campaign.directContactIds || []).map((id) => String(id)),
    );
    for (const entry of campaign.contacts || []) {
      directIds.add(String(entry.contactId));
    }

    const memberships = await this.groupsService.findMembershipsForGroups(
      userId,
      groupIds,
    );
    for (const membership of memberships) {
      const contactId = String(membership.contactId);
      const existing =
        recipients.get(contactId) ||
        ({
          contactId,
          direct: false,
          sourceGroupIds: [],
          snapshot: undefined,
        } as unknown as ResolvedRecipient);
      existing.sourceGroupIds = [
        ...new Set([...existing.sourceGroupIds, String(membership.groupId)]),
      ];
      recipients.set(contactId, existing);
    }

    for (const contactId of directIds) {
      const existing =
        recipients.get(contactId) ||
        ({
          contactId,
          sourceGroupIds: [],
          snapshot: undefined,
        } as unknown as ResolvedRecipient);
      existing.direct = true;
      recipients.set(contactId, existing);
    }

    const contacts = recipients.size
      ? await this.contactsService.findOwnedByIds(userId, [...recipients.keys()])
      : [];
    const resolved: ResolvedRecipient[] = [];
    for (const contact of contacts as any[]) {
      if (contact.doNotContact) {
        continue;
      }
      const entry = recipients.get(String(contact._id));
      if (!entry) {
        continue;
      }
      resolved.push({
        ...entry,
        snapshot: {
          name: contact.name,
          email: contact.email,
          company: contact.company,
          title: contact.title,
        },
      });
    }

    return resolved.sort((a, b) =>
      a.snapshot.email.localeCompare(b.snapshot.email),
    );
  }

  private async snapshotRecipients(
    userId: string,
    campaign: CampaignDocument,
    recipients: ResolvedRecipient[],
  ) {
    await this.recipientModel.bulkWrite(
      recipients.map((recipient) => ({
        updateOne: {
          filter: {
            userId,
            campaignId: campaign._id,
            contactId: new Types.ObjectId(recipient.contactId),
          },
          update: {
            $setOnInsert: {
              userId,
              campaignId: campaign._id,
              contactId: new Types.ObjectId(recipient.contactId),
              sourceGroupIds: recipient.sourceGroupIds.map(
                (id) => new Types.ObjectId(id),
              ),
              direct: recipient.direct,
              snapshot: recipient.snapshot,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  private async scheduleOutboxForStep(
    userId: string,
    campaign: CampaignDocument,
    recipient: ResolvedRecipient,
    step: SequenceStep,
  ) {
    const campaignId = String(campaign._id);
    const dedupeKey = `${campaignId}:${step.stepId}:${recipient.contactId}`;
    const delayMs = Math.max(0, Number(step.delayMinutes || 0)) * 60_000;
    const scheduledFor = new Date(Date.now() + delayMs);
    const outbox = await this.outboxModel.findOneAndUpdate(
      {
        campaignId: campaign._id,
        stepId: step.stepId,
        contactId: new Types.ObjectId(recipient.contactId),
      },
      {
        $setOnInsert: {
          userId,
          campaignId: campaign._id,
          contactId: new Types.ObjectId(recipient.contactId),
          stepId: step.stepId,
          stepOrder: step.order,
          dedupeKey,
          recipient: recipient.snapshot,
          status: OutboxStatus.QUEUED,
          scheduledFor,
          attempts: 0,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    if (outbox.status !== OutboxStatus.SENT) {
      await this.sequenceQueue.add(
        SEQUENCE_EMAIL_JOB,
        { outboxId: String(outbox._id) },
        {
          jobId: makeBullJobId(campaignId, step.stepId, recipient.contactId),
          delay: delayMs,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: 1000,
          removeOnFail: false,
        },
      );
    }

    return outbox;
  }

  private async markCampaignCompleteIfDone(userId: string, campaignId: string) {
    const unfinished = await this.outboxModel.countDocuments({
      userId,
      campaignId: new Types.ObjectId(campaignId),
      status: { $in: [OutboxStatus.QUEUED, OutboxStatus.PROCESSING] },
    });
    if (unfinished > 0) {
      return;
    }

    const total = await this.outboxModel.countDocuments({
      userId,
      campaignId: new Types.ObjectId(campaignId),
    });
    if (total > 0) {
      await this.campaignModel.updateOne(
        { userId, _id: campaignId, status: CampaignStatus.RUNNING },
        { $set: { status: CampaignStatus.COMPLETED, completedAt: new Date() } },
      );
    }
  }

  private async serializeCampaign(userId: string, campaign: CampaignDocument) {
    const plain = campaign.toObject();
    const contactIds = plain.contacts.map((entry) => String(entry.contactId));
    const contacts = contactIds.length
      ? await this.contactsService.findOwnedByIds(userId, contactIds)
      : [];
    const contactsById = new Map(
      contacts.map((contact: any) => [String(contact._id), contact]),
    );
    const recipients = await this.recipientModel
      .find({ userId, campaignId: campaign._id })
      .sort({ createdAt: 1, _id: 1 })
      .lean()
      .exec();

    return {
      ...serializeCampaignPlain(plain),
      contacts: plain.contacts.map((entry) => ({
        ...entry,
        contactId: String(entry.contactId),
        contact: contactsById.get(String(entry.contactId)),
      })),
      recipients: recipients.map((recipient: any) => ({
        ...recipient,
        _id: String(recipient._id),
        campaignId: String(recipient.campaignId),
        contactId: String(recipient.contactId),
        sourceGroupIds: (recipient.sourceGroupIds || []).map((id) => String(id)),
      })),
    };
  }
}

function toObjectIds(ids: string[], label: string) {
  return [...new Set(ids)].map((id) => {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid ${label} id: ${id}`);
    }
    return new Types.ObjectId(id);
  });
}

function makeCampaignContacts(contactIds: string[]) {
  return toObjectIds(contactIds, 'contact').map((contactId) => ({
    contactId,
    status: GenerationStatus.NOT_GENERATED,
  }));
}

function serializeCampaignPlain(campaign: any) {
  return {
    ...campaign,
    _id: String(campaign._id),
    targetGroupIds: (campaign.targetGroupIds || []).map((id) => String(id)),
    directContactIds: (campaign.directContactIds || []).map((id) => String(id)),
    sequenceSteps: campaign.sequenceSteps || [],
    contacts: campaign.contacts || [],
  };
}

function serializeOutboxPlain(row: any) {
  return {
    ...row,
    _id: String(row._id),
    campaignId: String(row.campaignId),
    contactId: String(row.contactId),
  };
}

function serializeCampaignTemplatePlain(template: any) {
  return {
    ...template,
    _id: String(template._id),
    id: String(template._id),
    steps: template.steps || [],
  };
}

function makeBullJobId(...parts: string[]) {
  return parts.map((part) => part.replace(/[^a-zA-Z0-9_-]/g, '_')).join('__');
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error('LLM request timed out')),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeout!);
  }
}

function inferRequestedStepCount(value: string): number | undefined {
  const normalized = (value || '').toLowerCase();
  const digitMatch = normalized.match(/\b([1-4])\s*[- ]?(?:step|email|message)s?\b/);
  if (digitMatch) {
    return Number(digitMatch[1]);
  }

  const wordToNumber: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
  };
  const wordMatch = normalized.match(
    /\b(one|two|three|four)\s*[- ]?(?:step|email|message)s?\b/,
  );
  return wordMatch ? wordToNumber[wordMatch[1]] : undefined;
}
