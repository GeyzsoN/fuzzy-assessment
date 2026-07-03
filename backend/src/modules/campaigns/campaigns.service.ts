import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
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
  CampaignGenerationRequest,
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
  RegenerateSequenceStepDto,
  UpdateSequenceStepDto,
} from './dtos/update-sequence-step.dto';
import {
  CAMPAIGN_GENERATION_ATTEMPTS,
  CAMPAIGN_GENERATION_JOB,
  CAMPAIGN_GENERATION_LEASE_MS,
  CAMPAIGN_GENERATION_MAX_ATTEMPTS,
  CAMPAIGN_GENERATION_QUEUE,
  CAMPAIGN_GENERATION_RECOVERY_BATCH_SIZE,
  CAMPAIGN_GENERATION_RECOVERY_INTERVAL_MS,
  CAMPAIGN_GENERATION_RECOVERY_JOB,
  CAMPAIGN_GENERATION_RECOVERY_JOB_ID,
  DISPATCH_DUE_SEQUENCE_EMAILS_JOB,
  DISPATCH_DUE_SEQUENCE_EMAILS_JOB_ID,
  OUTBOX_DISPATCH_BATCH_SIZE,
  OUTBOX_DISPATCH_INTERVAL_MS,
  QUEUE_BACKOFF_DELAY_MS,
  QUEUE_REMOVE_ON_COMPLETE,
  SEQUENCE_EMAIL_ATTEMPTS,
  SEQUENCE_EMAIL_JOB,
  SEQUENCE_EMAIL_QUEUE,
} from './sequence-queue.constants';
import {
  DEFAULT_CAMPAIGN_TEMPLATES,
  DEFAULT_PROMPT_TEMPLATES,
} from './default-campaign-templates';
import {
  buildCampaignDraftPrompt,
  buildSequenceStepRegenerationPrompt,
  clampMaxSteps,
  hydrateContactPlaceholders,
  normalizeSequenceSteps,
  parseCampaignDraftResponse,
  parseSequenceStepRegenerationResponse,
} from './campaign-generation.helpers';
import { ContactsService } from '../contacts/contacts.service';
import { GroupsService } from '../groups/groups.service';
import { LlmService } from '../../shared/llm/llm.service';
import {
  LlmQuotaUsage,
  LlmQuotaUsageDocument,
} from './schemas/llm-quota-usage.schema';
import {
  assertCampaignTransition,
  assertGenerationTransition,
  assertOutboxTransition,
} from './campaign-workflow';

type ResolvedRecipient = {
  contactId: string;
  direct: boolean;
  sourceGroupIds: string[];
  snapshot: RecipientSnapshot;
};

type IdempotencyContext = {
  scope: string;
  key: string;
  fingerprint: string;
};

type StoredCampaignGenerationRequest = Pick<
  CampaignGenerationRequest,
  | 'name'
  | 'templateId'
  | 'goal'
  | 'audienceDescription'
  | 'tone'
  | 'maxSteps'
  | 'groupIds'
  | 'contactIds'
>;

type CampaignGenerationJobData = {
  userId: string;
  campaignId: string;
  dto: GenerateCampaignDraftDto;
  generationAttemptId: string;
};

type RecoverStaleCampaignGenerationsOptions = {
  userId?: string;
  campaignId?: string;
  now?: Date;
  limit?: number;
};

const OUTBOX_PROCESSING_STALE_MS = 10 * 60 * 1000;
const DIRECT_GENERATION_LEASE_MS = 10 * 60 * 1000;
const GENERATABLE_CONTACT_STATUSES = [
  GenerationStatus.NOT_GENERATED,
  GenerationStatus.FAILED,
];
const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
const CREATE_CAMPAIGN_IDEMPOTENCY_SCOPE = 'campaign:create';
const GENERATE_DRAFT_IDEMPOTENCY_SCOPE = 'campaign:generate-draft';
const DEFAULT_LLM_DAILY_QUOTA_PER_USER = 100;
const DEFAULT_LLM_QUOTA_WINDOW_MS = 86_400_000;

@Injectable()
export class CampaignsService implements OnModuleInit {
  private readonly logger = new Logger(CampaignsService.name);

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
    @InjectModel(LlmQuotaUsage.name)
    private readonly llmQuotaUsageModel: Model<LlmQuotaUsageDocument>,
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
    await this.scheduleDueOutboxDispatcher();
    await this.scheduleCampaignGenerationRecoveryDispatcher();
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
    idempotencyKey?: string,
  ): Promise<any> {
    const idempotency = this.buildIdempotencyContext(
      GENERATE_DRAFT_IDEMPOTENCY_SCOPE,
      idempotencyKey,
      buildGenerateDraftFingerprintInput(dto),
    );
    const existing = await this.findIdempotentCampaign(userId, idempotency);
    if (existing) {
      return this.serializeCampaign(userId, existing);
    }

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

    const generationAttemptId = new Types.ObjectId().toHexString();
    const generationLockedAt = new Date();
    const generationRequest = buildStoredGenerationRequest(dto);

    let campaign: CampaignDocument;
    try {
      campaign = await this.campaignModel.create({
        userId,
        name: dto.name,
        status: CampaignStatus.GENERATING,
        targetGroupIds: toObjectIds(dto.groupIds || [], 'group'),
        directContactIds: toObjectIds(dto.contactIds || [], 'contact'),
        sequenceSteps: [],
        contacts: makeCampaignContacts(dto.contactIds || []),
        generationAttemptId,
        generationLockedAt,
        generationAttempts: 1,
        generationRequest,
        lastAttemptedAt: generationLockedAt,
        ...(idempotency
          ? {
              idempotencyScope: idempotency.scope,
              idempotencyKey: idempotency.key,
              idempotencyFingerprint: idempotency.fingerprint,
            }
          : {}),
      });
    } catch (error) {
      const raced = await this.resolveIdempotencyRace(userId, idempotency, error);
      if (raced) {
        return this.serializeCampaign(userId, raced);
      }
      throw error;
    }

    try {
      await this.consumeLlmQuota(userId, 'campaign-draft');
    } catch (error) {
      await this.campaignModel.updateOne(
        {
          _id: campaign._id,
          userId,
          status: CampaignStatus.GENERATING,
          generationAttemptId,
        },
        {
          $set: {
            status: CampaignStatus.FAILED,
            generationError: safeErrorMessage(error, 'LLM quota exceeded'),
            failedAt: new Date(),
            lastAttemptedAt: new Date(),
          },
          $unset: { generationAttemptId: '', generationLockedAt: '' },
        },
      );
      throw error;
    }

    try {
      await this.enqueueCampaignGeneration(
        userId,
        String(campaign._id),
        dto,
        generationAttemptId,
      );
      this.logger.log(
        `Queued campaign draft generation campaignId=${String(campaign._id)} userId=${userId} attemptId=${generationAttemptId}`,
      );
    } catch (error) {
      await this.campaignModel.updateOne(
        {
          _id: campaign._id,
          userId,
          status: CampaignStatus.GENERATING,
          generationAttemptId,
        },
        {
          $set: {
            status: CampaignStatus.FAILED,
            generationError: safeErrorMessage(
              error,
              'Campaign draft generation could not be queued',
            ),
            failedAt: new Date(),
            lastAttemptedAt: new Date(),
          },
          $unset: { generationAttemptId: '', generationLockedAt: '' },
        },
      );
      this.logger.error(
        `Failed to queue campaign draft generation campaignId=${String(campaign._id)} userId=${userId}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }

    return this.serializeCampaign(userId, campaign);
  }

  async processCampaignDraftGeneration(input: {
    userId: string;
    campaignId: string;
    dto: GenerateCampaignDraftDto;
    generationAttemptId?: string;
  }): Promise<void> {
    if (!input.generationAttemptId) {
      this.logger.warn(
        `Skipped campaign draft generation without attemptId campaignId=${input.campaignId} userId=${input.userId}`,
      );
      return;
    }

    const campaign = await this.requireCampaign(input.userId, input.campaignId);
    if (campaign.status === CampaignStatus.DRAFT) {
      return;
    }
    if (campaign.status !== CampaignStatus.GENERATING) {
      return;
    }
    if (campaign.generationAttemptId !== input.generationAttemptId) {
      this.logger.warn(
        `Skipped stale campaign draft generation campaignId=${String(campaign._id)} userId=${input.userId} attemptId=${input.generationAttemptId}`,
      );
      return;
    }
    assertCampaignTransition(campaign.status, CampaignStatus.GENERATING);

    const claimed = await this.campaignModel.updateOne(
      {
        _id: campaign._id,
        userId: input.userId,
        status: CampaignStatus.GENERATING,
        generationAttemptId: input.generationAttemptId,
      },
      {
        $set: {
          lastAttemptedAt: new Date(),
          generationLockedAt: new Date(),
        },
        $unset: { failedAt: '' },
      },
    );
    if (updateMatchedCount(claimed) === 0) {
      return;
    }

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

      const finished = await this.campaignModel.updateOne(
        {
          _id: campaign._id,
          userId: input.userId,
          status: CampaignStatus.GENERATING,
          generationAttemptId: input.generationAttemptId,
        },
        {
          $set: {
            status: CampaignStatus.DRAFT,
            promptTemplate: sequenceSteps[0]?.promptTemplate,
            sequenceSteps,
            generatedAt: new Date(),
          },
          $unset: {
            generationError: '',
            failedAt: '',
            generationAttemptId: '',
            generationLockedAt: '',
            generationAttempts: '',
            generationRequest: '',
          },
        },
      );
      if (updateMatchedCount(finished) === 0) {
        this.logger.warn(
          `Skipped stale campaign draft generation success campaignId=${String(campaign._id)} userId=${input.userId} attemptId=${input.generationAttemptId}`,
        );
        return;
      }
      this.logger.log(
        `Generated campaign draft campaignId=${String(campaign._id)} userId=${input.userId} attemptId=${input.generationAttemptId}`,
      );
    } catch (error) {
      const message = safeErrorMessage(error, 'Campaign draft generation failed');
      const failed = await this.campaignModel.updateOne(
        {
          _id: campaign._id,
          userId: input.userId,
          status: CampaignStatus.GENERATING,
          generationAttemptId: input.generationAttemptId,
        },
        {
          $set: {
            status: CampaignStatus.FAILED,
            generationError: message,
            failedAt: new Date(),
            lastAttemptedAt: new Date(),
          },
          $unset: {
            generationAttemptId: '',
            generationLockedAt: '',
          },
        },
      );
      if (updateMatchedCount(failed) === 0) {
        this.logger.warn(
          `Skipped stale campaign draft generation failure campaignId=${String(campaign._id)} userId=${input.userId} attemptId=${input.generationAttemptId}`,
        );
        return;
      }
      this.logger.error(
        `Campaign draft generation failed campaignId=${String(campaign._id)} userId=${input.userId} attemptId=${input.generationAttemptId}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  async create(
    userId: string,
    dto: CreateCampaignDto,
    idempotencyKey?: string,
  ): Promise<any> {
    const sequenceSteps = normalizeSequenceSteps(
      dto.sequenceSteps,
      dto.promptTemplate,
    );
    const idempotency = this.buildIdempotencyContext(
      CREATE_CAMPAIGN_IDEMPOTENCY_SCOPE,
      idempotencyKey,
      buildCreateCampaignFingerprintInput(dto, sequenceSteps),
    );
    const existing = await this.findIdempotentCampaign(userId, idempotency);
    if (existing) {
      return this.serializeCampaign(userId, existing);
    }

    await this.validateTargets(userId, dto.groupIds || [], dto.contactIds || []);

    let campaign: CampaignDocument;
    try {
      campaign = await this.campaignModel.create({
        userId,
        name: dto.name,
        status: CampaignStatus.DRAFT,
        promptTemplate: dto.promptTemplate || sequenceSteps[0]?.promptTemplate,
        targetGroupIds: toObjectIds(dto.groupIds || [], 'group'),
        directContactIds: toObjectIds(dto.contactIds || [], 'contact'),
        sequenceSteps,
        contacts: makeCampaignContacts(dto.contactIds || []),
        ...(idempotency
          ? {
              idempotencyScope: idempotency.scope,
              idempotencyKey: idempotency.key,
              idempotencyFingerprint: idempotency.fingerprint,
            }
          : {}),
      });
    } catch (error) {
      const raced = await this.resolveIdempotencyRace(userId, idempotency, error);
      if (raced) {
        return this.serializeCampaign(userId, raced);
      }
      throw error;
    }

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
    await this.recoverStaleCampaignGenerations({
      userId,
      limit: CAMPAIGN_GENERATION_RECOVERY_BATCH_SIZE,
    });
    const campaigns = await this.campaignModel
      .find({ userId })
      .sort({ createdAt: -1, _id: 1 })
      .lean()
      .exec();
    return campaigns.map((campaign: any) => serializeCampaignPlain(campaign));
  }

  async getOne(userId: string, campaignId: string): Promise<any> {
    let campaign = await this.requireCampaign(userId, campaignId);
    if (campaign.status === CampaignStatus.GENERATING) {
      await this.recoverStaleCampaignGenerations({
        userId,
        campaignId,
        limit: 1,
      });
      campaign = await this.requireCampaign(userId, campaignId);
    }
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

    const contactObjectIds = contacts.map(
      (contact: any) => new Types.ObjectId(String(contact._id)),
    );
    const draftFilter = {
      _id: campaign._id,
      userId,
      $or: [{ status: CampaignStatus.DRAFT }, { status: { $exists: false } }],
    };

    const directUpdate = await this.campaignModel.updateOne(draftFilter, {
      $addToSet: { directContactIds: { $each: contactObjectIds } },
    });
    if (directUpdate.matchedCount === 0) {
      throw new BadRequestException('Only draft campaigns can be edited');
    }

    if (contactObjectIds.length) {
      await this.campaignModel.bulkWrite(
        contactObjectIds.map((contactId) => ({
          updateOne: {
            filter: {
              ...draftFilter,
              $nor: [{ contacts: { $elemMatch: { contactId } } }],
            },
            update: {
              $push: {
                contacts: {
                  contactId,
                  status: GenerationStatus.NOT_GENERATED,
                },
              },
            },
          },
        })),
        { ordered: false },
      );
    }

    const updated = await this.requireCampaign(userId, campaignId);
    return this.serializeCampaign(userId, updated);
  }

  async launch(userId: string, campaignId: string): Promise<any> {
    const campaign = await this.requireCampaign(userId, campaignId);
    if (campaign.status && campaign.status !== CampaignStatus.DRAFT) {
      throw new BadRequestException('Campaign has already been launched');
    }
    assertCampaignTransition(
      campaign.status || CampaignStatus.DRAFT,
      CampaignStatus.LAUNCHING,
    );

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
          lastAttemptedAt: new Date(),
          sequenceSteps,
        },
        $unset: { failedAt: '', generationError: '' },
      },
      { new: true },
    );
    if (!claimed) {
      throw new BadRequestException('Campaign has already been launched');
    }

    try {
      await this.snapshotRecipients(userId, claimed, recipients);
      const firstStep = sequenceSteps[0];
      for (const recipient of recipients) {
        await this.scheduleOutboxForStep(userId, claimed, recipient, firstStep);
      }

      await this.campaignModel.updateOne(
        { _id: claimed._id, userId, status: CampaignStatus.LAUNCHING },
        {
          $set: { status: CampaignStatus.RUNNING },
          $unset: { generationError: '', failedAt: '' },
        },
      );
      this.logger.log(
        `Launched campaign campaignId=${String(claimed._id)} userId=${userId}`,
      );

      const updated = await this.requireCampaign(userId, campaignId);
      return this.serializeCampaign(userId, updated);
    } catch (error) {
      await this.campaignModel.updateOne(
        { _id: claimed._id, userId, status: CampaignStatus.LAUNCHING },
        {
          $set: {
            status: CampaignStatus.FAILED,
            generationError: safeErrorMessage(error, 'Campaign launch failed'),
            failedAt: new Date(),
            lastAttemptedAt: new Date(),
          },
        },
      );
      this.logger.error(
        `Campaign launch failed campaignId=${String(claimed._id)} userId=${userId}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
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
    assertCampaignTransition(campaign.status, CampaignStatus.GENERATING);

    const dto = await this.buildGenerationDtoFromCampaign(campaign);
    const groupIds = dto.groupIds || [];
    const contactIds = dto.contactIds || [];
    const generationAttemptId = new Types.ObjectId().toHexString();
    const generationLockedAt = new Date();
    const generationRequest = buildStoredGenerationRequest(dto);

    const claimed = await this.campaignModel.findOneAndUpdate(
      {
        _id: campaign._id,
        userId,
        status: { $in: [CampaignStatus.DRAFT, CampaignStatus.FAILED] },
      },
      {
        $set: {
          status: CampaignStatus.GENERATING,
          targetGroupIds: toObjectIds(groupIds, 'group'),
          directContactIds: toObjectIds(contactIds, 'contact'),
          sequenceSteps: [],
          generationAttemptId,
          generationLockedAt,
          generationAttempts: 1,
          generationRequest,
          lastAttemptedAt: generationLockedAt,
        },
        $unset: { generationError: '', failedAt: '' },
      },
      { new: true },
    );
    if (!claimed) {
      const latest = await this.requireCampaign(userId, campaignId);
      if (latest.status === CampaignStatus.GENERATING) {
        return this.serializeCampaign(userId, latest);
      }
      throw new BadRequestException('Only draft campaigns can generate a sequence');
    }

    try {
      await this.consumeLlmQuota(userId, 'campaign-sequence');
    } catch (error) {
      await this.campaignModel.updateOne(
        {
          _id: claimed._id,
          userId,
          status: CampaignStatus.GENERATING,
          generationAttemptId,
        },
        {
          $set: {
            status: CampaignStatus.FAILED,
            generationError: safeErrorMessage(error, 'LLM quota exceeded'),
            failedAt: new Date(),
            lastAttemptedAt: new Date(),
          },
          $unset: { generationAttemptId: '', generationLockedAt: '' },
        },
      );
      throw error;
    }

    try {
      await this.enqueueCampaignGeneration(
        userId,
        String(claimed._id),
        dto,
        generationAttemptId,
      );
      this.logger.log(
        `Queued campaign sequence generation campaignId=${String(claimed._id)} userId=${userId} attemptId=${generationAttemptId}`,
      );
    } catch (error) {
      await this.campaignModel.updateOne(
        {
          _id: claimed._id,
          userId,
          status: CampaignStatus.GENERATING,
          generationAttemptId,
        },
        {
          $set: {
            status: CampaignStatus.FAILED,
            generationError: safeErrorMessage(
              error,
              'Campaign sequence generation could not be queued',
            ),
            failedAt: new Date(),
            lastAttemptedAt: new Date(),
          },
          $unset: { generationAttemptId: '', generationLockedAt: '' },
        },
      );
      this.logger.error(
        `Failed to queue campaign sequence generation campaignId=${String(claimed._id)} userId=${userId}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }

    return this.serializeCampaign(userId, claimed);
  }

  async retryGeneration(userId: string, campaignId: string): Promise<any> {
    const campaign = await this.requireCampaign(userId, campaignId);
    if (campaign.status !== CampaignStatus.FAILED) {
      throw new BadRequestException('Only failed campaign generation can be retried');
    }

    const generationRequest = normalizeStoredGenerationRequest(
      campaign.generationRequest,
    );
    if (!generationRequest) {
      throw new BadRequestException(
        'Campaign generation cannot be retried because recovery metadata is missing',
      );
    }

    const dto = storedGenerationRequestToDto(generationRequest);
    await this.validateTargets(userId, dto.groupIds || [], dto.contactIds || []);

    const generationAttemptId = new Types.ObjectId().toHexString();
    const generationLockedAt = new Date();
    const claimed = await this.campaignModel.findOneAndUpdate(
      {
        _id: campaign._id,
        userId,
        status: CampaignStatus.FAILED,
        generationRequest: { $exists: true },
      },
      {
        $set: {
          status: CampaignStatus.GENERATING,
          generationAttemptId,
          generationLockedAt,
          generationAttempts: 1,
          lastAttemptedAt: generationLockedAt,
        },
        $unset: { generationError: '', failedAt: '' },
      },
      { new: true },
    );
    if (!claimed) {
      const latest = await this.requireCampaign(userId, campaignId);
      if (latest.status === CampaignStatus.GENERATING) {
        return this.serializeCampaign(userId, latest);
      }
      throw new BadRequestException('Only failed campaign generation can be retried');
    }

    try {
      await this.consumeLlmQuota(userId, 'campaign-generation-retry');
    } catch (error) {
      await this.campaignModel.updateOne(
        {
          _id: claimed._id,
          userId,
          status: CampaignStatus.GENERATING,
          generationAttemptId,
        },
        {
          $set: {
            status: CampaignStatus.FAILED,
            generationError: safeErrorMessage(error, 'LLM quota exceeded'),
            failedAt: new Date(),
            lastAttemptedAt: new Date(),
          },
          $unset: { generationAttemptId: '', generationLockedAt: '' },
        },
      );
      throw error;
    }

    try {
      await this.enqueueCampaignGeneration(
        userId,
        String(claimed._id),
        dto,
        generationAttemptId,
      );
      this.logger.log(
        `Retried campaign generation campaignId=${String(claimed._id)} userId=${userId} attemptId=${generationAttemptId}`,
      );
    } catch (error) {
      await this.campaignModel.updateOne(
        {
          _id: claimed._id,
          userId,
          status: CampaignStatus.GENERATING,
          generationAttemptId,
        },
        {
          $set: {
            status: CampaignStatus.FAILED,
            generationError: safeErrorMessage(
              error,
              'Campaign generation retry could not be queued',
            ),
            failedAt: new Date(),
            lastAttemptedAt: new Date(),
          },
          $unset: { generationAttemptId: '', generationLockedAt: '' },
        },
      );
      this.logger.error(
        `Failed to queue campaign generation retry campaignId=${String(claimed._id)} userId=${userId}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }

    const updated = await this.requireCampaign(userId, campaignId);
    return this.serializeCampaign(userId, updated);
  }

  async debugSimulateGenerationWorkerCrash(
    userId: string,
    campaignId: string,
  ): Promise<any> {
    this.assertDebugWorkflowTriggersEnabled();
    const campaign = await this.requireCampaign(userId, campaignId);
    if (
      campaign.status !== CampaignStatus.DRAFT &&
      campaign.status !== CampaignStatus.FAILED &&
      campaign.status !== CampaignStatus.GENERATING
    ) {
      throw new BadRequestException(
        'Debug generation crash simulation is only available before launch',
      );
    }

    const storedRequest = normalizeStoredGenerationRequest(
      campaign.generationRequest,
    );
    const dto = storedRequest
      ? storedGenerationRequestToDto(storedRequest)
      : await this.buildGenerationDtoFromCampaign(campaign);
    await this.validateTargets(userId, dto.groupIds || [], dto.contactIds || []);

    const generationAttemptId = `debug-${new Types.ObjectId().toHexString()}`;
    const generationLockedAt = new Date(
      Date.now() - CAMPAIGN_GENERATION_LEASE_MS - 1000,
    );
    const updated = await this.campaignModel.findOneAndUpdate(
      { _id: campaign._id, userId },
      {
        $set: {
          status: CampaignStatus.GENERATING,
          targetGroupIds: toObjectIds(dto.groupIds || [], 'group'),
          directContactIds: toObjectIds(dto.contactIds || [], 'contact'),
          sequenceSteps: [],
          generationAttemptId,
          generationLockedAt,
          generationAttempts: 1,
          generationRequest: buildStoredGenerationRequest(dto),
          generationError: 'Debug: simulated worker crash after generation claim',
          lastAttemptedAt: generationLockedAt,
        },
        $unset: { failedAt: '' },
      },
      { new: true },
    );
    if (!updated) {
      throw new NotFoundException('Campaign not found');
    }

    this.logger.warn(
      `Debug simulated campaign generation worker crash campaignId=${String(campaign._id)} userId=${userId} attemptId=${generationAttemptId}`,
    );
    return this.serializeCampaign(userId, updated);
  }

  async debugRecoverGeneration(
    userId: string,
    campaignId: string,
  ): Promise<{ recovery: { scanned: number; requeued: number; failed: number }; campaign: any }> {
    this.assertDebugWorkflowTriggersEnabled();
    const recovery = await this.recoverStaleCampaignGenerations({
      userId,
      campaignId,
      limit: 1,
    });
    const campaign = await this.requireCampaign(userId, campaignId);
    return {
      recovery,
      campaign: await this.serializeCampaign(userId, campaign),
    };
  }

  async updateSequenceStep(
    userId: string,
    campaignId: string,
    stepId: string,
    dto: UpdateSequenceStepDto,
  ): Promise<any> {
    if (
      dto.delayMinutes === undefined &&
      dto.subjectTemplate === undefined &&
      dto.promptTemplate === undefined
    ) {
      throw new BadRequestException('At least one sequence step field is required');
    }

    const campaign = await this.requireCampaign(userId, campaignId);
    this.assertSequenceTemplatesEditable(campaign.status);

    const steps = normalizeSequenceSteps(
      campaign.sequenceSteps,
      campaign.promptTemplate,
    );
    const step = findSequenceStep(steps, stepId);
    if (!step) {
      throw new NotFoundException('Sequence step not found');
    }

    const updatedStep = {
      ...step,
      delayMinutes:
        dto.delayMinutes !== undefined ? dto.delayMinutes : step.delayMinutes,
      subjectTemplate:
        dto.subjectTemplate !== undefined
          ? dto.subjectTemplate.trim()
          : step.subjectTemplate,
      promptTemplate:
        dto.promptTemplate !== undefined
          ? dto.promptTemplate.trim()
          : step.promptTemplate,
    };
    const nextSteps = normalizeSequenceSteps(
      steps.map((entry) =>
        entry.stepId === step.stepId ? updatedStep : entry,
      ),
      campaign.promptTemplate,
    );

    const updated = await this.campaignModel.findOneAndUpdate(
      {
        _id: campaign._id,
        userId,
        $or: [
          { status: { $in: [CampaignStatus.DRAFT, CampaignStatus.FAILED] } },
          { status: { $exists: false } },
        ],
        'sequenceSteps.stepId': step.stepId,
      },
      {
        $set: {
          sequenceSteps: nextSteps,
          promptTemplate: nextSteps[0]?.promptTemplate,
        },
      },
      { new: true },
    );
    if (!updated) {
      throw new BadRequestException('Only draft campaigns can be edited');
    }

    this.logger.log(
      `Updated sequence step campaignId=${String(campaign._id)} stepId=${step.stepId} userId=${userId}`,
    );
    return this.serializeCampaign(userId, updated);
  }

  async regenerateSequenceStep(
    userId: string,
    campaignId: string,
    stepId: string,
    dto: RegenerateSequenceStepDto = {},
  ): Promise<{ step: SequenceStep }> {
    const campaign = await this.requireCampaign(userId, campaignId);
    this.assertSequenceTemplatesEditable(campaign.status);

    const steps = normalizeSequenceSteps(
      campaign.sequenceSteps,
      campaign.promptTemplate,
    );
    const step = findSequenceStep(steps, stepId);
    if (!step) {
      throw new NotFoundException('Sequence step not found');
    }

    try {
      await this.consumeLlmQuota(userId, 'sequence-step-regeneration');
      const prompt = buildSequenceStepRegenerationPrompt({
        campaignName: campaign.name,
        campaignPrompt: campaign.promptTemplate,
        step,
        instructions: dto.instructions,
      });
      const llmOutput = await withTimeout(this.llm.complete(prompt), 12000);
      const regeneratedStep = parseSequenceStepRegenerationResponse(
        llmOutput,
        step,
      );

      this.logger.log(
        `Generated sequence step proposal campaignId=${String(campaign._id)} stepId=${step.stepId} userId=${userId}`,
      );
      return { step: regeneratedStep };
    } catch (error) {
      if (isTooManyRequestsError(error) || error instanceof ConflictException) {
        throw error;
      }
      const message = safeErrorMessage(error, 'Sequence step regeneration failed');
      await this.campaignModel.updateOne(
        { _id: campaign._id, userId },
        {
          $set: {
            generationError: message,
            lastAttemptedAt: new Date(),
          },
        },
      );
      this.logger.error(
        `Sequence step regeneration failed campaignId=${String(campaign._id)} stepId=${step.stepId} userId=${userId}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
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
    assertGenerationTransition(entry.status, GenerationStatus.PENDING);

    const generationAttemptId = new Types.ObjectId().toHexString();
    const staleGenerationLockedBefore = new Date(
      Date.now() - DIRECT_GENERATION_LEASE_MS,
    );
    const claimed = await this.campaignModel.findOneAndUpdate(
      {
        _id: campaign._id,
        userId,
        contacts: {
          $elemMatch: {
            contactId: outboxContactId,
            $or: [
              { status: { $in: GENERATABLE_CONTACT_STATUSES } },
              {
                status: GenerationStatus.PENDING,
                generationLockedAt: { $lte: staleGenerationLockedBefore },
              },
            ],
          },
        },
      },
      {
        $set: {
          'contacts.$.status': GenerationStatus.PENDING,
          'contacts.$.generationAttemptId': generationAttemptId,
          'contacts.$.generationLockedAt': new Date(),
        },
        $unset: {
          'contacts.$.error': '',
          'contacts.$.generatedMessage': '',
        },
      },
      { new: true },
    );
    if (!claimed) {
      this.logger.log(
        `Skipped direct generation claim campaignId=${String(campaign._id)} contactId=${contactId} userId=${userId}`,
      );
      return this.readCampaignContactResult(
        userId,
        campaign._id,
        outboxContactId,
      );
    }
    this.logger.log(
      `Claimed direct generation campaignId=${String(campaign._id)} contactId=${contactId} userId=${userId}`,
    );

    try {
      await this.consumeLlmQuota(userId, 'contact-message');
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

      const finished = await this.campaignModel.findOneAndUpdate(
        {
          _id: campaign._id,
          userId,
          contacts: {
            $elemMatch: {
              contactId: outboxContactId,
              status: GenerationStatus.PENDING,
              generationAttemptId,
            },
          },
        },
        {
          $set: {
            'contacts.$.status': GenerationStatus.FINISHED,
            'contacts.$.generatedMessage': message,
          },
          $unset: {
            'contacts.$.error': '',
            'contacts.$.generationAttemptId': '',
            'contacts.$.generationLockedAt': '',
          },
        },
        { new: true },
      );
      if (!finished) {
        return this.readCampaignContactResult(
          userId,
          campaign._id,
          outboxContactId,
        );
      }

      return { status: GenerationStatus.FINISHED, message };
    } catch (error) {
      const message = safeErrorMessage(error, 'Message generation failed');
      const failed = await this.campaignModel.updateOne(
        {
          _id: campaign._id,
          userId,
          contacts: {
            $elemMatch: {
              contactId: outboxContactId,
              status: GenerationStatus.PENDING,
              generationAttemptId,
            },
          },
        },
        {
          $set: {
            'contacts.$.status': GenerationStatus.FAILED,
            'contacts.$.error': message,
          },
          $unset: {
            'contacts.$.generatedMessage': '',
            'contacts.$.generationAttemptId': '',
            'contacts.$.generationLockedAt': '',
          },
        },
      );
      if (isTooManyRequestsError(error)) {
        throw error;
      }
      if (failed.matchedCount === 0) {
        return this.readCampaignContactResult(
          userId,
          campaign._id,
          outboxContactId,
        );
      }

      return { status: GenerationStatus.FAILED, error: message };
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
    assertOutboxTransition(current.status, OutboxStatus.PROCESSING);

    const staleLockedBefore = new Date(Date.now() - OUTBOX_PROCESSING_STALE_MS);
    const claimed = await this.outboxModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(outboxId),
        $or: [
          { status: { $in: [OutboxStatus.QUEUED, OutboxStatus.FAILED] } },
          {
            status: OutboxStatus.PROCESSING,
            lockedAt: { $lte: staleLockedBefore },
          },
        ],
      },
      {
        $set: {
          status: OutboxStatus.PROCESSING,
          lockedAt: new Date(),
          lastAttemptedAt: new Date(),
        },
        $unset: { error: '', failedAt: '' },
        $inc: { attempts: 1 },
      },
      { new: true },
    );
    if (!claimed) {
      return;
    }
    if (current.status === OutboxStatus.PROCESSING) {
      this.logger.warn(
        `Reclaimed stale outbox lock outboxId=${outboxId} userId=${current.userId}`,
      );
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
          $unset: { error: '', lockedAt: '', failedAt: '' },
        },
      );
      this.logger.log(
        `Processed outbox message outboxId=${String(claimed._id)} campaignId=${String(campaign._id)} userId=${claimed.userId}`,
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
            failedAt: new Date(),
            lastAttemptedAt: new Date(),
          },
          $unset: { lockedAt: '' },
        },
      );
      this.logger.error(
        `Outbox processing failed outboxId=${String(claimed._id)} userId=${claimed.userId}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  async dispatchDueOutboxMessages(
    now = new Date(),
  ): Promise<{ enqueued: number }> {
    const rows = await this.outboxModel
      .find({
        status: OutboxStatus.QUEUED,
        $or: [
          { scheduledFor: { $lte: now } },
          { scheduledFor: { $exists: false } },
        ],
      })
      .sort({ scheduledFor: 1, _id: 1 })
      .limit(OUTBOX_DISPATCH_BATCH_SIZE)
      .lean()
      .exec();

    let enqueued = 0;
    for (const row of rows as any[]) {
      await this.enqueueOutboxMessage(
        String(row.campaignId),
        row.stepId,
        String(row.contactId),
        String(row._id),
        0,
      );
      enqueued += 1;
    }

    if (enqueued > 0) {
      this.logger.log(`Dispatched due outbox messages count=${enqueued}`);
    }

    return { enqueued };
  }

  async recoverStaleCampaignGenerations(
    options: RecoverStaleCampaignGenerationsOptions = {},
  ): Promise<{ scanned: number; requeued: number; failed: number }> {
    const now = options.now || new Date();
    const staleLockedBefore = new Date(
      now.getTime() - CAMPAIGN_GENERATION_LEASE_MS,
    );
    const filter: any = {
      status: CampaignStatus.GENERATING,
      $or: [
        { generationLockedAt: { $lte: staleLockedBefore } },
        { generationLockedAt: { $exists: false } },
        { generationAttemptId: { $exists: false } },
        { generationRequest: { $exists: false } },
      ],
    };
    if (options.userId) {
      filter.userId = options.userId;
    }
    if (options.campaignId) {
      filter._id = new Types.ObjectId(options.campaignId);
    }

    const campaigns = await this.campaignModel
      .find(filter)
      .sort({ generationLockedAt: 1, lastAttemptedAt: 1, _id: 1 })
      .limit(options.limit || CAMPAIGN_GENERATION_RECOVERY_BATCH_SIZE)
      .lean()
      .exec();

    let requeued = 0;
    let failed = 0;
    for (const campaign of campaigns as any[]) {
      const generationRequest = normalizeStoredGenerationRequest(
        campaign.generationRequest,
      );
      if (!campaign.generationAttemptId || !generationRequest) {
        const result = await this.campaignModel.updateOne(
          {
            _id: campaign._id,
            userId: campaign.userId,
            status: CampaignStatus.GENERATING,
          },
          {
            $set: {
              status: CampaignStatus.FAILED,
              generationError:
                'Campaign generation recovery metadata is missing. Retry generation from the campaign page.',
              failedAt: now,
              lastAttemptedAt: now,
            },
            $unset: { generationAttemptId: '', generationLockedAt: '' },
          },
        );
        if (updateMatchedCount(result) !== 0) {
          failed += 1;
          this.logger.warn(
            `Marked campaign generation failed due missing recovery metadata campaignId=${String(campaign._id)} userId=${campaign.userId}`,
          );
        }
        continue;
      }

      const attempts = Number(campaign.generationAttempts || 0);
      if (attempts >= CAMPAIGN_GENERATION_MAX_ATTEMPTS) {
        const result = await this.campaignModel.updateOne(
          {
            _id: campaign._id,
            userId: campaign.userId,
            status: CampaignStatus.GENERATING,
            generationAttemptId: campaign.generationAttemptId,
          },
          {
            $set: {
              status: CampaignStatus.FAILED,
              generationError: `Campaign generation stalled after ${CAMPAIGN_GENERATION_MAX_ATTEMPTS} attempts. Retry generation from the campaign page.`,
              failedAt: now,
              lastAttemptedAt: now,
            },
            $unset: { generationAttemptId: '', generationLockedAt: '' },
          },
        );
        if (updateMatchedCount(result) !== 0) {
          failed += 1;
          this.logger.warn(
            `Marked campaign generation failed after max attempts campaignId=${String(campaign._id)} userId=${campaign.userId} attempts=${attempts}`,
          );
        }
        continue;
      }

      const nextAttemptId = new Types.ObjectId().toHexString();
      const claimed = await this.campaignModel.findOneAndUpdate(
        {
          _id: campaign._id,
          userId: campaign.userId,
          status: CampaignStatus.GENERATING,
          generationAttemptId: campaign.generationAttemptId,
          $or: [
            { generationLockedAt: { $lte: staleLockedBefore } },
            { generationLockedAt: { $exists: false } },
          ],
        },
        {
          $set: {
            generationAttemptId: nextAttemptId,
            generationLockedAt: now,
            generationError: 'Recovery attempt queued',
            lastAttemptedAt: now,
          },
          $inc: { generationAttempts: 1 },
          $unset: { failedAt: '' },
        },
        { new: true },
      );
      if (!claimed) {
        continue;
      }

      try {
        await this.enqueueCampaignGeneration(
          campaign.userId,
          String(campaign._id),
          storedGenerationRequestToDto(generationRequest),
          nextAttemptId,
        );
        requeued += 1;
        this.logger.warn(
          `Requeued stale campaign generation campaignId=${String(campaign._id)} userId=${campaign.userId} attemptId=${nextAttemptId} previousAttemptId=${campaign.generationAttemptId}`,
        );
      } catch (error) {
        await this.campaignModel.updateOne(
          {
            _id: campaign._id,
            userId: campaign.userId,
            status: CampaignStatus.GENERATING,
            generationAttemptId: nextAttemptId,
          },
          {
            $set: {
              status: CampaignStatus.FAILED,
              generationError: safeErrorMessage(
                error,
                'Campaign generation recovery could not be queued',
              ),
              failedAt: now,
              lastAttemptedAt: now,
            },
            $unset: { generationAttemptId: '', generationLockedAt: '' },
          },
        );
        failed += 1;
        this.logger.error(
          `Failed to queue stale campaign generation recovery campaignId=${String(campaign._id)} userId=${campaign.userId}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    return { scanned: campaigns.length, requeued, failed };
  }

  private async readCampaignContactResult(
    userId: string,
    campaignId: Types.ObjectId,
    contactId: Types.ObjectId,
  ): Promise<{ status: string; message?: string; error?: string }> {
    const campaign = await this.campaignModel
      .findOne({ _id: campaignId, userId, 'contacts.contactId': contactId })
      .lean()
      .exec();
    const entry = campaign?.contacts?.find(
      (campaignContact: any) => String(campaignContact.contactId) === String(contactId),
    );
    if (!entry) {
      throw new BadRequestException('Contact is not attached to this campaign');
    }

    return generationResultFromEntry(entry);
  }

  private buildIdempotencyContext(
    scope: string,
    idempotencyKey: string | undefined,
    payload: unknown,
  ): IdempotencyContext | undefined {
    const key = normalizeIdempotencyKey(idempotencyKey);
    if (!key) {
      return undefined;
    }
    return {
      scope,
      key,
      fingerprint: stableStringify(payload),
    };
  }

  private async findIdempotentCampaign(
    userId: string,
    idempotency: IdempotencyContext | undefined,
  ): Promise<CampaignDocument | undefined> {
    if (!idempotency) {
      return undefined;
    }

    const existing = await this.campaignModel.findOne({
      userId,
      idempotencyScope: idempotency.scope,
      idempotencyKey: idempotency.key,
    });
    if (!existing) {
      return undefined;
    }

    if (existing.idempotencyFingerprint !== idempotency.fingerprint) {
      this.logger.warn(
        `Idempotency conflict userId=${userId} scope=${idempotency.scope}`,
      );
      throw new ConflictException(
        'Idempotency-Key was already used with a different request payload',
      );
    }
    this.logger.log(
      `Idempotency hit userId=${userId} scope=${idempotency.scope} campaignId=${String(existing._id)}`,
    );
    return existing;
  }

  private async resolveIdempotencyRace(
    userId: string,
    idempotency: IdempotencyContext | undefined,
    error: unknown,
  ): Promise<CampaignDocument | undefined> {
    if (!idempotency || !isDuplicateKeyError(error)) {
      return undefined;
    }
    return this.findIdempotentCampaign(userId, idempotency);
  }

  private async consumeLlmQuota(userId: string, reason: string) {
    const limit = readPositiveEnvInt(
      'LLM_DAILY_QUOTA_PER_USER',
      DEFAULT_LLM_DAILY_QUOTA_PER_USER,
    );
    if (limit <= 0) {
      return;
    }

    const windowMs = readPositiveEnvInt(
      'LLM_QUOTA_WINDOW_MS',
      DEFAULT_LLM_QUOTA_WINDOW_MS,
    );
    const now = new Date();
    const windowStart = new Date(
      Math.floor(now.getTime() / windowMs) * windowMs,
    );
    const windowEnd = new Date(windowStart.getTime() + windowMs);

    await this.llmQuotaUsageModel.updateOne(
      { userId, windowStart },
      {
        $setOnInsert: {
          userId,
          windowStart,
          windowEnd,
          count: 0,
        },
      },
      { upsert: true },
    );

    const usage = await this.llmQuotaUsageModel.findOneAndUpdate(
      {
        userId,
        windowStart,
        count: { $lt: limit },
      },
      {
        $inc: { count: 1 },
        $set: {
          windowEnd,
          lastUsedAt: now,
        },
      },
      { new: true },
    );

    if (!usage) {
      this.logger.warn(
        `LLM quota exceeded userId=${userId} reason=${reason} limit=${limit}`,
      );
      throw new HttpException(
        'Daily LLM quota exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.logger.log(
      `Consumed LLM quota userId=${userId} reason=${reason} count=${usage.count}/${limit}`,
    );
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

  private assertSequenceTemplatesEditable(status?: CampaignStatus) {
    if (
      status &&
      status !== CampaignStatus.DRAFT &&
      status !== CampaignStatus.FAILED
    ) {
      throw new BadRequestException(
        'Sequence templates are locked after launch',
      );
    }
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

  private async buildGenerationDtoFromCampaign(
    campaign: CampaignDocument,
  ): Promise<GenerateCampaignDraftDto> {
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
    return {
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
  }

  private assertDebugWorkflowTriggersEnabled() {
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException('Campaign not found');
    }
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

  private async enqueueCampaignGeneration(
    userId: string,
    campaignId: string,
    dto: GenerateCampaignDraftDto,
    generationAttemptId: string,
  ) {
    const data: CampaignGenerationJobData = {
      userId,
      campaignId,
      dto,
      generationAttemptId,
    };
    await this.campaignGenerationQueue.add(CAMPAIGN_GENERATION_JOB, data, {
      jobId: makeBullJobId(
        CAMPAIGN_GENERATION_JOB,
        campaignId,
        generationAttemptId,
      ),
      attempts: CAMPAIGN_GENERATION_ATTEMPTS,
      backoff: { type: 'exponential', delay: QUEUE_BACKOFF_DELAY_MS },
      removeOnComplete: QUEUE_REMOVE_ON_COMPLETE,
      removeOnFail: false,
    });
  }

  private async scheduleDueOutboxDispatcher() {
    try {
      await this.sequenceQueue.add(
        DISPATCH_DUE_SEQUENCE_EMAILS_JOB,
        {},
        {
          jobId: DISPATCH_DUE_SEQUENCE_EMAILS_JOB_ID,
          repeat: { every: OUTBOX_DISPATCH_INTERVAL_MS },
          removeOnComplete: QUEUE_REMOVE_ON_COMPLETE,
          removeOnFail: false,
        },
      );
    } catch (error) {
      this.logger.error(
        'Failed to schedule due outbox dispatcher',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async scheduleCampaignGenerationRecoveryDispatcher() {
    try {
      await this.campaignGenerationQueue.add(
        CAMPAIGN_GENERATION_RECOVERY_JOB,
        {},
        {
          jobId: CAMPAIGN_GENERATION_RECOVERY_JOB_ID,
          repeat: { every: CAMPAIGN_GENERATION_RECOVERY_INTERVAL_MS },
          removeOnComplete: QUEUE_REMOVE_ON_COMPLETE,
          removeOnFail: false,
        },
      );
    } catch (error) {
      this.logger.error(
        'Failed to schedule campaign generation recovery dispatcher',
        error instanceof Error ? error.stack : undefined,
      );
    }
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
      try {
        await this.enqueueOutboxMessage(
          campaignId,
          step.stepId,
          recipient.contactId,
          String(outbox._id),
          delayMs,
        );
      } catch (error) {
        this.logger.warn(
          `Outbox queue add failed; dispatcher will retry outboxId=${String(outbox._id)} campaignId=${campaignId}`,
        );
      }
    }

    return outbox;
  }

  private async enqueueOutboxMessage(
    campaignId: string,
    stepId: string,
    contactId: string,
    outboxId: string,
    delayMs: number,
  ) {
    await this.sequenceQueue.add(
      SEQUENCE_EMAIL_JOB,
      { outboxId },
      {
        jobId: makeBullJobId(campaignId, stepId, contactId),
        delay: Math.max(0, delayMs),
        attempts: SEQUENCE_EMAIL_ATTEMPTS,
        backoff: { type: 'exponential', delay: QUEUE_BACKOFF_DELAY_MS },
        removeOnComplete: QUEUE_REMOVE_ON_COMPLETE,
        removeOnFail: false,
      },
    );
  }

  private async markCampaignCompleteIfDone(userId: string, campaignId: string) {
    const unfinished = await this.outboxModel.countDocuments({
      userId,
      campaignId: new Types.ObjectId(campaignId),
      status: {
        $in: [OutboxStatus.QUEUED, OutboxStatus.PROCESSING, OutboxStatus.FAILED],
      },
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
        ...serializeCampaignContactPlain(entry),
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

function buildStoredGenerationRequest(
  dto: GenerateCampaignDraftDto,
): StoredCampaignGenerationRequest {
  return {
    name: dto.name,
    templateId: dto.templateId,
    goal: dto.goal,
    audienceDescription: dto.audienceDescription,
    tone: dto.tone,
    maxSteps: dto.maxSteps,
    groupIds: normalizeIdList(dto.groupIds || []),
    contactIds: normalizeIdList(dto.contactIds || []),
  };
}

function normalizeStoredGenerationRequest(
  request: any,
): StoredCampaignGenerationRequest | undefined {
  if (!request) {
    return undefined;
  }
  const plain = typeof request.toObject === 'function' ? request.toObject() : request;
  const name = stringOrUndefined(plain.name);
  const templateId = stringOrUndefined(plain.templateId);
  const goal = stringOrUndefined(plain.goal);
  const audienceDescription = stringOrUndefined(plain.audienceDescription);
  if (!name || !templateId || !goal || !audienceDescription) {
    return undefined;
  }

  return {
    name,
    templateId,
    goal,
    audienceDescription,
    tone: stringOrUndefined(plain.tone),
    maxSteps: numberOrUndefined(plain.maxSteps),
    groupIds: normalizeIdList(
      Array.isArray(plain.groupIds) ? plain.groupIds.map(String) : [],
    ),
    contactIds: normalizeIdList(
      Array.isArray(plain.contactIds) ? plain.contactIds.map(String) : [],
    ),
  };
}

function storedGenerationRequestToDto(
  request: StoredCampaignGenerationRequest,
): GenerateCampaignDraftDto {
  return {
    name: request.name,
    templateId: request.templateId,
    goal: request.goal,
    audienceDescription: request.audienceDescription,
    tone: request.tone,
    maxSteps: request.maxSteps,
    groupIds: request.groupIds || [],
    contactIds: request.contactIds || [],
  };
}

function buildCreateCampaignFingerprintInput(
  dto: CreateCampaignDto,
  sequenceSteps: SequenceStep[],
) {
  return {
    name: dto.name,
    promptTemplate: dto.promptTemplate || sequenceSteps[0]?.promptTemplate || null,
    groupIds: normalizeIdList(dto.groupIds || []),
    contactIds: normalizeIdList(dto.contactIds || []),
    sequenceSteps: sequenceSteps.map((step) => ({
      stepId: step.stepId,
      order: step.order,
      delayMinutes: step.delayMinutes,
      subjectTemplate: step.subjectTemplate,
      promptTemplate: step.promptTemplate,
    })),
  };
}

function buildGenerateDraftFingerprintInput(dto: GenerateCampaignDraftDto) {
  return {
    name: dto.name,
    goal: dto.goal,
    audienceDescription: dto.audienceDescription,
    templateId: dto.templateId,
    tone: dto.tone || null,
    maxSteps: dto.maxSteps || null,
    groupIds: normalizeIdList(dto.groupIds || []),
    contactIds: normalizeIdList(dto.contactIds || []),
  };
}

function normalizeIdList(ids: string[]) {
  return [...new Set(ids)].sort();
}

function makeCampaignContacts(contactIds: string[]) {
  return toObjectIds(contactIds, 'contact').map((contactId) => ({
    contactId,
    status: GenerationStatus.NOT_GENERATED,
  }));
}

function findSequenceStep(steps: SequenceStep[], stepId: string) {
  const decoded = decodeURIComponent(stepId);
  return steps.find(
    (step) => step.stepId === decoded || String(step.order) === decoded,
  );
}

function serializeCampaignPlain(campaign: any) {
  const canRetryGeneration = Boolean(
    campaign?.status === CampaignStatus.FAILED &&
      normalizeStoredGenerationRequest(campaign?.generationRequest),
  );
  const {
    idempotencyScope: _idempotencyScope,
    idempotencyKey: _idempotencyKey,
    idempotencyFingerprint: _idempotencyFingerprint,
    generationAttemptId: _generationAttemptId,
    generationLockedAt: _generationLockedAt,
    generationAttempts: _generationAttempts,
    generationRequest: _generationRequest,
    ...publicCampaign
  } = campaign || {};

  return {
    ...publicCampaign,
    _id: String(publicCampaign._id),
    canRetryGeneration,
    targetGroupIds: (publicCampaign.targetGroupIds || []).map((id) => String(id)),
    directContactIds: (publicCampaign.directContactIds || []).map((id) =>
      String(id),
    ),
    sequenceSteps: publicCampaign.sequenceSteps || [],
    contacts: (publicCampaign.contacts || []).map(serializeCampaignContactPlain),
  };
}

function serializeCampaignContactPlain(entry: any) {
  const plain = typeof entry?.toObject === 'function' ? entry.toObject() : entry;
  const {
    generationAttemptId: _generationAttemptId,
    generationLockedAt: _generationLockedAt,
    ...rest
  } = plain || {};
  return {
    ...rest,
    contactId: rest?.contactId ? String(rest.contactId) : rest?.contactId,
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

function updateMatchedCount(result: any) {
  if (!result) {
    return 0;
  }
  if (typeof result.matchedCount === 'number') {
    return result.matchedCount;
  }
  if (typeof result.n === 'number') {
    return result.n;
  }
  return 1;
}

function stringOrUndefined(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberOrUndefined(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
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

function generationResultFromEntry(entry: any) {
  if (entry.status === GenerationStatus.FINISHED) {
    return { status: entry.status, message: entry.generatedMessage };
  }
  if (entry.status === GenerationStatus.FAILED) {
    return { status: entry.status, error: entry.error || 'Message generation failed' };
  }
  return { status: entry.status || GenerationStatus.NOT_GENERATED };
}

function safeErrorMessage(error: unknown, fallback: string) {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === 'string') {
      return response;
    }
    if (typeof response === 'object' && response !== null && 'message' in response) {
      const message = (response as { message?: string | string[] }).message;
      return Array.isArray(message) ? message[0] || fallback : message || fallback;
    }
  }

  if (error instanceof Error && /timed out/i.test(error.message)) {
    return error.message;
  }

  return fallback;
}

function isTooManyRequestsError(error: unknown) {
  return (
    error instanceof HttpException &&
    error.getStatus() === HttpStatus.TOO_MANY_REQUESTS
  );
}

function normalizeIdempotencyKey(value?: string) {
  const key = (value || '').trim();
  if (!key) {
    return undefined;
  }
  if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new BadRequestException('Idempotency-Key is too long');
  }
  return key;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function isDuplicateKeyError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: number }).code === 11000
  );
}

function readPositiveEnvInt(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
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
