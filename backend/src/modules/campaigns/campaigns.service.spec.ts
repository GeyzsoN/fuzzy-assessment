import { Types } from 'mongoose';
import { CampaignsService } from './campaigns.service';
import { CampaignStatus, GenerationStatus } from './schemas/campaign.schema';
import { OutboxStatus } from './schemas/outbox-message.schema';
import {
  CAMPAIGN_GENERATION_JOB,
  SEQUENCE_EMAIL_JOB,
} from './sequence-queue.constants';

describe('CampaignsService workflow hardening', () => {
  const userId = 'user-1';
  let service: CampaignsService;
  let campaignModel: any;
  let recipientModel: any;
  let outboxModel: any;
  let campaignTemplateModel: any;
  let promptTemplateModel: any;
  let llmQuotaUsageModel: any;
  let sequenceQueue: any;
  let campaignGenerationQueue: any;
  let contactsService: any;
  let groupsService: any;
  let llm: any;

  beforeEach(() => {
    campaignModel = {
      create: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
      bulkWrite: jest.fn().mockResolvedValue({}),
      deleteOne: jest.fn(),
    };
    recipientModel = {
      find: jest.fn().mockReturnValue(query([])),
      bulkWrite: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn(),
    };
    outboxModel = {
      find: jest.fn(),
      findById: jest.fn(),
      findOne: jest.fn().mockReturnValue(query(null)),
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
      countDocuments: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(0) }),
      deleteMany: jest.fn(),
    };
    campaignTemplateModel = {
      findOne: jest.fn(),
      updateOne: jest.fn(),
    };
    promptTemplateModel = {
      findOne: jest.fn(),
      updateOne: jest.fn(),
    };
    llmQuotaUsageModel = {
      updateOne: jest.fn().mockResolvedValue({}),
      findOneAndUpdate: jest.fn().mockResolvedValue({ count: 1 }),
    };
    sequenceQueue = {
      add: jest.fn(),
      remove: jest.fn(),
    };
    campaignGenerationQueue = {
      add: jest.fn(),
    };
    contactsService = {
      findOwnedByIds: jest.fn(),
    };
    groupsService = {
      findMembershipsForGroups: jest.fn(),
    };
    llm = {
      complete: jest.fn(),
    };

    service = new CampaignsService(
      campaignModel,
      recipientModel,
      outboxModel,
      campaignTemplateModel,
      promptTemplateModel,
      llmQuotaUsageModel,
      sequenceQueue,
      campaignGenerationQueue,
      contactsService,
      groupsService,
      llm,
    );
  });

  it('claims direct contact generation before calling the LLM', async () => {
    const campaignId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const campaign = makeCampaign(campaignId, contactId);
    jest.spyOn(service as any, 'requireCampaign').mockResolvedValue(campaign);
    contactsService.findOwnedByIds.mockResolvedValue([
      {
        _id: contactId,
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        company: 'Acme',
      },
    ]);
    campaignModel.findOneAndUpdate
      .mockResolvedValueOnce({ _id: campaignId })
      .mockResolvedValueOnce({ _id: campaignId });
    llm.complete.mockResolvedValue('  Hi Ada, quick idea for Acme.  ');

    const result = await service.generateForContact(
      userId,
      String(campaignId),
      String(contactId),
    );

    expect(result).toEqual({
      status: GenerationStatus.FINISHED,
      message: 'Hi Ada, quick idea for Acme.',
    });
    expect(campaignModel.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
      _id: campaignId,
      userId,
      contacts: {
        $elemMatch: {
          contactId,
          $or: [
            {
              status: {
                $in: [GenerationStatus.NOT_GENERATED, GenerationStatus.FAILED],
              },
            },
            {
              status: GenerationStatus.PENDING,
              generationLockedAt: { $lte: expect.any(Date) },
            },
          ],
        },
      },
    });
    expect(campaignModel.findOneAndUpdate.mock.calls[0][1]).toMatchObject({
      $set: {
        'contacts.$.status': GenerationStatus.PENDING,
        'contacts.$.generationAttemptId': expect.any(String),
        'contacts.$.generationLockedAt': expect.any(Date),
      },
    });
    expect(campaignModel.findOneAndUpdate.mock.calls[1][1]).toMatchObject({
      $unset: {
        'contacts.$.error': '',
        'contacts.$.generationAttemptId': '',
        'contacts.$.generationLockedAt': '',
      },
    });
    expect(llmQuotaUsageModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        count: { $lt: 100 },
      }),
      expect.objectContaining({
        $inc: { count: 1 },
      }),
      { new: true },
    );
    expect(
      campaignModel.findOneAndUpdate.mock.invocationCallOrder[0],
    ).toBeLessThan(llm.complete.mock.invocationCallOrder[0]);
  });

  it('returns pending and skips the LLM when another request already claimed generation', async () => {
    const campaignId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const campaign = makeCampaign(campaignId, contactId);
    jest.spyOn(service as any, 'requireCampaign').mockResolvedValue(campaign);
    contactsService.findOwnedByIds.mockResolvedValue([
      {
        _id: contactId,
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        company: 'Acme',
      },
    ]);
    campaignModel.findOneAndUpdate.mockResolvedValueOnce(null);
    campaignModel.findOne.mockReturnValueOnce(
      query({
        contacts: [
          {
            contactId,
            status: GenerationStatus.PENDING,
            generationLockedAt: new Date(),
          },
        ],
      }),
    );

    const result = await service.generateForContact(
      userId,
      String(campaignId),
      String(contactId),
    );

    expect(result).toEqual({ status: GenerationStatus.PENDING });
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('stores a safe direct generation error without leaking provider details', async () => {
    const campaignId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const campaign = makeCampaign(campaignId, contactId);
    jest.spyOn(service as any, 'requireCampaign').mockResolvedValue(campaign);
    contactsService.findOwnedByIds.mockResolvedValue([
      {
        _id: contactId,
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        company: 'Acme',
      },
    ]);
    campaignModel.findOneAndUpdate.mockResolvedValueOnce({ _id: campaignId });
    llm.complete.mockRejectedValue(
      new Error('provider rejected secret api key sk-test'),
    );

    const result = await service.generateForContact(
      userId,
      String(campaignId),
      String(contactId),
    );

    expect(result).toEqual({
      status: GenerationStatus.FAILED,
      error: 'Message generation failed',
    });
    expect(campaignModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        contacts: {
          $elemMatch: expect.objectContaining({
            contactId,
            status: GenerationStatus.PENDING,
            generationAttemptId: expect.any(String),
          }),
        },
      }),
      expect.objectContaining({
        $set: {
          'contacts.$.status': GenerationStatus.FAILED,
          'contacts.$.error': 'Message generation failed',
        },
        $unset: {
          'contacts.$.generatedMessage': '',
          'contacts.$.generationAttemptId': '',
          'contacts.$.generationLockedAt': '',
        },
      }),
    );
  });

  it('throws when direct generation exceeds the LLM quota', async () => {
    const campaignId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const campaign = makeCampaign(campaignId, contactId);
    jest.spyOn(service as any, 'requireCampaign').mockResolvedValue(campaign);
    contactsService.findOwnedByIds.mockResolvedValue([
      {
        _id: contactId,
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        company: 'Acme',
      },
    ]);
    campaignModel.findOneAndUpdate.mockResolvedValueOnce({ _id: campaignId });
    llmQuotaUsageModel.findOneAndUpdate.mockResolvedValueOnce(null);

    await expect(
      service.generateForContact(userId, String(campaignId), String(contactId)),
    ).rejects.toThrow('Daily LLM quota exceeded');

    expect(llm.complete).not.toHaveBeenCalled();
    expect(campaignModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        contacts: {
          $elemMatch: expect.objectContaining({
            contactId,
            status: GenerationStatus.PENDING,
            generationAttemptId: expect.any(String),
          }),
        },
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          'contacts.$.status': GenerationStatus.FAILED,
          'contacts.$.error': 'Daily LLM quota exceeded',
        }),
      }),
    );
  });

  it('reclaims stale pending direct generation leases', async () => {
    const campaignId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const campaign = makeCampaign(campaignId, contactId, [
      {
        contactId,
        status: GenerationStatus.PENDING,
        generationLockedAt: new Date(Date.now() - 20 * 60 * 1000),
      },
    ]);
    jest.spyOn(service as any, 'requireCampaign').mockResolvedValue(campaign);
    contactsService.findOwnedByIds.mockResolvedValue([
      {
        _id: contactId,
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        company: 'Acme',
      },
    ]);
    campaignModel.findOneAndUpdate
      .mockResolvedValueOnce({ _id: campaignId })
      .mockResolvedValueOnce({ _id: campaignId });
    llm.complete.mockResolvedValue('Hi Ada, quick idea for Acme.');

    const result = await service.generateForContact(
      userId,
      String(campaignId),
      String(contactId),
    );

    expect(result).toEqual({
      status: GenerationStatus.FINISHED,
      message: 'Hi Ada, quick idea for Acme.',
    });
    expect(campaignModel.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
      contacts: {
        $elemMatch: {
          contactId,
          $or: expect.arrayContaining([
            {
              status: GenerationStatus.PENDING,
              generationLockedAt: { $lte: expect.any(Date) },
            },
          ]),
        },
      },
    });
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it('does not let a stale direct generation attempt overwrite newer state', async () => {
    const campaignId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const campaign = makeCampaign(campaignId, contactId);
    jest.spyOn(service as any, 'requireCampaign').mockResolvedValue(campaign);
    contactsService.findOwnedByIds.mockResolvedValue([
      {
        _id: contactId,
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        company: 'Acme',
      },
    ]);
    campaignModel.findOneAndUpdate
      .mockResolvedValueOnce({ _id: campaignId })
      .mockResolvedValueOnce(null);
    campaignModel.findOne.mockReturnValueOnce(
      query({
        contacts: [{ contactId, status: GenerationStatus.PENDING }],
      }),
    );
    llm.complete.mockResolvedValue('Hi Ada.');

    const result = await service.generateForContact(
      userId,
      String(campaignId),
      String(contactId),
    );

    expect(result).toEqual({ status: GenerationStatus.PENDING });
    expect(campaignModel.findOneAndUpdate.mock.calls[1][0]).toMatchObject({
      contacts: {
        $elemMatch: {
          contactId,
          status: GenerationStatus.PENDING,
          generationAttemptId: expect.any(String),
        },
      },
    });
  });

  it('returns an existing campaign for duplicate create idempotency keys', async () => {
    const campaignId = new Types.ObjectId();
    const existing = makeCampaign(campaignId, new Types.ObjectId());
    (existing as any).idempotencyFingerprint =
      '{"contactIds":[],"groupIds":[],"name":"Founder outreach","promptTemplate":"Hi {{first_name}}, quick idea for {{company}}.","sequenceSteps":[{"delayMinutes":0,"order":1,"promptTemplate":"Hi {{first_name}}, quick idea for {{company}}.","stepId":"step-1","subjectTemplate":"Intro for {{company}}"}]}';
    campaignModel.findOne.mockResolvedValueOnce(existing);
    jest.spyOn(service as any, 'serializeCampaign').mockResolvedValue({
      _id: String(campaignId),
    });

    const result = await service.create(
      userId,
      {
        name: 'Founder outreach',
        promptTemplate: 'Hi {{first_name}}, quick idea for {{company}}.',
        groupIds: [],
        contactIds: [],
      },
      'create-key',
    );

    expect(result).toEqual({ _id: String(campaignId) });
    expect(campaignModel.create).not.toHaveBeenCalled();
  });

  it('returns an existing campaign for duplicate draft generation idempotency keys without enqueueing', async () => {
    const campaignId = new Types.ObjectId();
    const existing = makeCampaign(campaignId, new Types.ObjectId(), []);
    (existing as any).idempotencyFingerprint =
      '{"audienceDescription":"Founders","contactIds":[],"goal":"Book calls","groupIds":[],"maxSteps":3,"name":"Generated sequence","templateId":"cold-intro","tone":"direct"}';
    campaignModel.findOne.mockResolvedValueOnce(existing);
    jest.spyOn(service as any, 'serializeCampaign').mockResolvedValue({
      _id: String(campaignId),
    });

    const result = await service.generateDraft(
      userId,
      {
        name: 'Generated sequence',
        goal: 'Book calls',
        audienceDescription: 'Founders',
        templateId: 'cold-intro',
        tone: 'direct',
        maxSteps: 3,
        groupIds: [],
        contactIds: [],
      },
      'draft-key',
    );

    expect(result).toEqual({ _id: String(campaignId) });
    expect(campaignModel.create).not.toHaveBeenCalled();
    expect(campaignGenerationQueue.add).not.toHaveBeenCalled();
    expect(llmQuotaUsageModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects reused idempotency keys with different payloads', async () => {
    const existing = makeCampaign(new Types.ObjectId(), new Types.ObjectId());
    (existing as any).idempotencyFingerprint = '{"different":true}';
    campaignModel.findOne.mockResolvedValueOnce(existing);

    await expect(
      service.create(
        userId,
        {
          name: 'Founder outreach',
          promptTemplate: 'Hi {{first_name}}, quick idea for {{company}}.',
          groupIds: [],
          contactIds: [],
        },
        'create-key',
      ),
    ).rejects.toThrow('different request payload');
    expect(campaignModel.create).not.toHaveBeenCalled();
  });

  it('returns the existing campaign when an idempotent create loses a duplicate-key race', async () => {
    const campaignId = new Types.ObjectId();
    const existing = makeCampaign(campaignId, new Types.ObjectId());
    jest
      .spyOn(service as any, 'findIdempotentCampaign')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(existing);
    jest.spyOn(service as any, 'serializeCampaign').mockResolvedValue({
      _id: String(campaignId),
    });
    campaignModel.create.mockRejectedValue({ code: 11000 });

    const result = await service.create(
      userId,
      {
        name: 'Founder outreach',
        promptTemplate: 'Hi {{first_name}}, quick idea for {{company}}.',
        groupIds: [],
        contactIds: [],
      },
      'race-key',
    );

    expect(result).toEqual({ _id: String(campaignId) });
    expect(campaignModel.create).toHaveBeenCalledTimes(1);
  });

  it('attaches contacts with atomic updates instead of read-modify-save', async () => {
    const campaignId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const campaign = makeCampaign(campaignId, contactId, []);
    jest.spyOn(service as any, 'requireCampaign').mockResolvedValue(campaign);
    jest.spyOn(service as any, 'serializeCampaign').mockResolvedValue({
      _id: String(campaignId),
    });
    contactsService.findOwnedByIds.mockResolvedValue([
      { _id: contactId, name: 'Ada Lovelace', email: 'ada@example.com' },
    ]);

    await service.attachContacts(userId, String(campaignId), {
      contactIds: [String(contactId)],
    });

    expect(campaign.save).not.toHaveBeenCalled();
    expect(campaignModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: campaignId,
        userId,
      }),
      {
        $addToSet: {
          directContactIds: { $each: [contactId] },
        },
      },
    );
    expect(campaignModel.bulkWrite).toHaveBeenCalledWith(
      [
        {
          updateOne: {
            filter: expect.objectContaining({
              _id: campaignId,
              userId,
              $nor: [{ contacts: { $elemMatch: { contactId } } }],
            }),
            update: {
              $push: {
                contacts: {
                  contactId,
                  status: GenerationStatus.NOT_GENERATED,
                },
              },
            },
          },
        },
      ],
      { ordered: false },
    );
  });

  it('enqueues sequence generation only after the campaign status claim succeeds', async () => {
    const campaignId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const campaign = makeCampaign(campaignId, contactId);
    jest.spyOn(service as any, 'requireCampaign').mockResolvedValue(campaign);
    jest.spyOn(service as any, 'findDefaultCampaignTemplate').mockResolvedValue({
      _id: new Types.ObjectId(),
      defaultMaxSteps: 3,
      steps: [{ order: 1 }],
    });
    jest.spyOn(service as any, 'serializeCampaign').mockResolvedValue({
      status: CampaignStatus.GENERATING,
    });
    campaignModel.findOneAndUpdate.mockResolvedValueOnce({
      ...campaign,
      status: CampaignStatus.GENERATING,
    });

    await service.generateSequence(userId, String(campaignId));

    expect(campaignModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: campaignId,
        userId,
        status: { $in: [CampaignStatus.DRAFT, CampaignStatus.FAILED] },
      }),
      expect.objectContaining({
        $set: expect.objectContaining({ status: CampaignStatus.GENERATING }),
      }),
      { new: true },
    );
    expect(campaignGenerationQueue.add).toHaveBeenCalledTimes(1);
  });

  it('marks sequence generation failed when queue submission fails after claim', async () => {
    const campaignId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const campaign = makeCampaign(campaignId, contactId);
    jest.spyOn(service as any, 'requireCampaign').mockResolvedValue(campaign);
    jest.spyOn(service as any, 'findDefaultCampaignTemplate').mockResolvedValue({
      _id: new Types.ObjectId(),
      defaultMaxSteps: 3,
      steps: [{ order: 1 }],
    });
    campaignModel.findOneAndUpdate.mockResolvedValueOnce({
      ...campaign,
      status: CampaignStatus.GENERATING,
    });
    campaignGenerationQueue.add.mockRejectedValue(new Error('redis unavailable'));

    await expect(
      service.generateSequence(userId, String(campaignId)),
    ).rejects.toThrow('redis unavailable');

    expect(campaignModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: campaignId,
        userId,
        status: CampaignStatus.GENERATING,
        generationAttemptId: expect.any(String),
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: CampaignStatus.FAILED,
          generationError: 'Campaign sequence generation could not be queued',
          failedAt: expect.any(Date),
          lastAttemptedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('does not enqueue sequence generation when the atomic claim loses', async () => {
    const campaignId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const campaign = makeCampaign(campaignId, contactId);
    const latest = { ...campaign, status: CampaignStatus.GENERATING };
    jest
      .spyOn(service as any, 'requireCampaign')
      .mockResolvedValueOnce(campaign)
      .mockResolvedValueOnce(latest);
    jest.spyOn(service as any, 'findDefaultCampaignTemplate').mockResolvedValue({
      _id: new Types.ObjectId(),
      defaultMaxSteps: 3,
      steps: [{ order: 1 }],
    });
    jest.spyOn(service as any, 'serializeCampaign').mockResolvedValue({
      status: CampaignStatus.GENERATING,
    });
    campaignModel.findOneAndUpdate.mockResolvedValueOnce(null);

    const result = await service.generateSequence(userId, String(campaignId));

    expect(result).toEqual({ status: CampaignStatus.GENERATING });
    expect(campaignGenerationQueue.add).not.toHaveBeenCalled();
  });

  it('marks draft generation failed when the initial queue submission fails', async () => {
    const campaignId = new Types.ObjectId();
    const campaign = makeCampaign(campaignId, new Types.ObjectId(), []);
    campaignTemplateModel.findOne.mockReturnValueOnce(
      query({
        _id: new Types.ObjectId(),
        key: 'cold-intro',
        name: 'Cold intro',
        defaultMaxSteps: 3,
        promptTemplateKey: 'sequence-draft-v1',
        steps: [],
      }),
    );
    promptTemplateModel.findOne.mockReturnValueOnce(
      query({
        key: 'sequence-draft-v1',
        name: 'Sequence draft',
        systemPrompt: 'System',
        userPrompt: 'User',
      }),
    );
    campaignModel.create.mockResolvedValue(campaign);
    campaignGenerationQueue.add.mockRejectedValue(new Error('redis unavailable'));

    await expect(
      service.generateDraft(userId, {
        name: 'Generated sequence',
        goal: 'Book calls',
        audienceDescription: 'Founders',
        templateId: 'cold-intro',
        tone: 'direct',
        maxSteps: 3,
        groupIds: [],
        contactIds: [],
      }),
    ).rejects.toThrow('redis unavailable');

    expect(campaignModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: campaignId,
        userId,
        status: CampaignStatus.GENERATING,
        generationAttemptId: expect.any(String),
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: CampaignStatus.FAILED,
          generationError: 'Campaign draft generation could not be queued',
          failedAt: expect.any(Date),
          lastAttemptedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('marks draft generation failed and does not enqueue when quota is exceeded', async () => {
    const campaignId = new Types.ObjectId();
    const campaign = makeCampaign(campaignId, new Types.ObjectId(), []);
    campaignTemplateModel.findOne.mockReturnValueOnce(
      query({
        _id: new Types.ObjectId(),
        key: 'cold-intro',
        name: 'Cold intro',
        defaultMaxSteps: 3,
        promptTemplateKey: 'sequence-draft-v1',
        steps: [],
      }),
    );
    promptTemplateModel.findOne.mockReturnValueOnce(
      query({
        key: 'sequence-draft-v1',
        name: 'Sequence draft',
        systemPrompt: 'System',
        userPrompt: 'User',
      }),
    );
    campaignModel.create.mockResolvedValue(campaign);
    llmQuotaUsageModel.findOneAndUpdate.mockResolvedValueOnce(null);

    await expect(
      service.generateDraft(userId, {
        name: 'Generated sequence',
        goal: 'Book calls',
        audienceDescription: 'Founders',
        templateId: 'cold-intro',
        tone: 'direct',
        maxSteps: 3,
        groupIds: [],
        contactIds: [],
      }),
    ).rejects.toThrow('Daily LLM quota exceeded');

    expect(campaignGenerationQueue.add).not.toHaveBeenCalled();
    expect(campaignModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: campaignId,
        userId,
        status: CampaignStatus.GENERATING,
        generationAttemptId: expect.any(String),
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: CampaignStatus.FAILED,
          generationError: 'Daily LLM quota exceeded',
          failedAt: expect.any(Date),
          lastAttemptedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('stores recovery metadata before queueing initial draft generation', async () => {
    const campaignId = new Types.ObjectId();
    const campaign = makeCampaign(campaignId, new Types.ObjectId(), []);
    campaignTemplateModel.findOne.mockReturnValueOnce(
      query({
        _id: new Types.ObjectId(),
        key: 'cold-intro',
        name: 'Cold intro',
        defaultMaxSteps: 3,
        promptTemplateKey: 'sequence-draft-v1',
        steps: [],
      }),
    );
    promptTemplateModel.findOne.mockReturnValueOnce(
      query({
        key: 'sequence-draft-v1',
        name: 'Sequence draft',
        systemPrompt: 'System',
        userPrompt: 'User',
      }),
    );
    campaignModel.create.mockImplementation(async (doc: any) => ({
      ...campaign,
      ...doc,
      _id: campaignId,
    }));
    jest.spyOn(service as any, 'serializeCampaign').mockResolvedValue({
      status: CampaignStatus.GENERATING,
    });

    await service.generateDraft(userId, {
      name: 'Generated sequence',
      goal: 'Book calls',
      audienceDescription: 'Founders',
      templateId: 'cold-intro',
      tone: 'direct',
      maxSteps: 3,
      groupIds: [],
      contactIds: [],
    });

    const createPayload = campaignModel.create.mock.calls[0][0];
    expect(createPayload).toMatchObject({
      status: CampaignStatus.GENERATING,
      generationAttemptId: expect.any(String),
      generationLockedAt: expect.any(Date),
      generationAttempts: 1,
      lastAttemptedAt: expect.any(Date),
      generationRequest: {
        name: 'Generated sequence',
        goal: 'Book calls',
        audienceDescription: 'Founders',
        templateId: 'cold-intro',
        tone: 'direct',
        maxSteps: 3,
        groupIds: [],
        contactIds: [],
      },
    });
    expect(campaignGenerationQueue.add).toHaveBeenCalledWith(
      CAMPAIGN_GENERATION_JOB,
      expect.objectContaining({
        campaignId: String(campaignId),
        userId,
        generationAttemptId: createPayload.generationAttemptId,
      }),
      expect.objectContaining({
        jobId: expect.stringContaining(createPayload.generationAttemptId),
        removeOnFail: false,
      }),
    );
  });

  it('writes campaign draft generation success only for the matching attempt', async () => {
    const campaignId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const attemptId = 'attempt-current';
    const campaign = makeCampaign(campaignId, contactId);
    campaign.status = CampaignStatus.GENERATING;
    campaign.generationAttemptId = attemptId;
    jest.spyOn(service as any, 'requireCampaign').mockResolvedValue(campaign);
    campaignTemplateModel.findOne.mockReturnValueOnce(
      query({
        _id: new Types.ObjectId(),
        key: 'cold-intro',
        defaultMaxSteps: 1,
        promptTemplateKey: 'sequence-draft-v1',
        steps: [
          {
            order: 1,
            delayDays: 0,
            subjectTemplate: 'Idea for {{company}}',
            promptTemplate: 'Hi {{first_name}}, quick idea for {{company}}.',
          },
        ],
      }),
    );
    promptTemplateModel.findOne.mockReturnValueOnce(
      query({
        key: 'sequence-draft-v1',
        systemPrompt: 'System',
        userPrompt: 'Goal {{goal}} audience {{audienceDescription}}',
      }),
    );
    llm.complete.mockResolvedValue(
      JSON.stringify([
        {
          order: 1,
          delayDays: 0,
          subjectTemplate: 'Idea for {{company}}',
          promptTemplate: 'Hi {{first_name}}, quick idea for {{company}}.',
        },
      ]),
    );

    await service.processCampaignDraftGeneration({
      userId,
      campaignId: String(campaignId),
      generationAttemptId: attemptId,
      dto: {
        name: 'Generated sequence',
        goal: 'Book calls',
        audienceDescription: 'Founders',
        templateId: 'cold-intro',
        maxSteps: 1,
        groupIds: [],
        contactIds: [],
      },
    });

    const successCall = campaignModel.updateOne.mock.calls.find(
      (call: any[]) => call[1]?.$set?.status === CampaignStatus.DRAFT,
    );
    expect(successCall?.[0]).toMatchObject({
      _id: campaignId,
      userId,
      status: CampaignStatus.GENERATING,
      generationAttemptId: attemptId,
    });
    expect(successCall?.[1]).toMatchObject({
      $set: expect.objectContaining({
        status: CampaignStatus.DRAFT,
        sequenceSteps: expect.arrayContaining([
          expect.objectContaining({ stepId: 'step-1' }),
        ]),
      }),
      $unset: expect.objectContaining({
        generationAttemptId: '',
        generationLockedAt: '',
        generationAttempts: '',
        generationRequest: '',
      }),
    });
  });

  it('does not let a stale campaign draft worker overwrite a newer attempt', async () => {
    const campaignId = new Types.ObjectId();
    const campaign = makeCampaign(campaignId, new Types.ObjectId());
    campaign.status = CampaignStatus.GENERATING;
    campaign.generationAttemptId = 'new-attempt';
    jest.spyOn(service as any, 'requireCampaign').mockResolvedValue(campaign);

    await service.processCampaignDraftGeneration({
      userId,
      campaignId: String(campaignId),
      generationAttemptId: 'old-attempt',
      dto: {
        name: 'Generated sequence',
        goal: 'Book calls',
        audienceDescription: 'Founders',
        templateId: 'cold-intro',
        maxSteps: 1,
        groupIds: [],
        contactIds: [],
      },
    });

    expect(llm.complete).not.toHaveBeenCalled();
    expect(campaignModel.updateOne).not.toHaveBeenCalled();
  });

  it('re-enqueues stale generating campaigns with a new attempt id', async () => {
    const now = new Date('2026-07-01T00:00:00.000Z');
    const campaignId = new Types.ObjectId();
    const stale = {
      _id: campaignId,
      userId,
      status: CampaignStatus.GENERATING,
      generationAttemptId: 'old-attempt',
      generationLockedAt: new Date(now.getTime() - 20 * 60 * 1000),
      generationAttempts: 1,
      generationRequest: makeGenerationRequest(),
    };
    campaignModel.find.mockReturnValueOnce(query([stale]));
    campaignModel.findOneAndUpdate.mockResolvedValueOnce({
      ...stale,
      generationAttemptId: 'new-attempt',
    });

    const result = await service.recoverStaleCampaignGenerations({ now });

    expect(result).toEqual({ scanned: 1, requeued: 1, failed: 0 });
    expect(campaignModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: campaignId,
        userId,
        status: CampaignStatus.GENERATING,
        generationAttemptId: 'old-attempt',
        $or: expect.arrayContaining([
          { generationLockedAt: { $lte: expect.any(Date) } },
        ]),
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          generationAttemptId: expect.any(String),
          generationLockedAt: now,
          generationError: 'Recovery attempt queued',
        }),
        $inc: { generationAttempts: 1 },
      }),
      { new: true },
    );
    expect(campaignGenerationQueue.add).toHaveBeenCalledWith(
      CAMPAIGN_GENERATION_JOB,
      expect.objectContaining({
        campaignId: String(campaignId),
        userId,
        generationAttemptId: expect.not.stringMatching('old-attempt'),
      }),
      expect.objectContaining({
        jobId: expect.stringContaining(String(campaignId)),
      }),
    );
    expect(llmQuotaUsageModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('marks old stuck campaigns failed when recovery metadata is missing', async () => {
    const now = new Date('2026-07-01T00:00:00.000Z');
    const campaignId = new Types.ObjectId();
    campaignModel.find.mockReturnValueOnce(
      query([
        {
          _id: campaignId,
          userId,
          status: CampaignStatus.GENERATING,
          generationAttemptId: 'old-attempt',
          generationLockedAt: new Date(now.getTime() - 20 * 60 * 1000),
        },
      ]),
    );

    const result = await service.recoverStaleCampaignGenerations({ now });

    expect(result).toEqual({ scanned: 1, requeued: 0, failed: 1 });
    expect(campaignModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: campaignId,
        userId,
        status: CampaignStatus.GENERATING,
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: CampaignStatus.FAILED,
          generationError: expect.stringContaining('metadata is missing'),
          failedAt: now,
        }),
        $unset: { generationAttemptId: '', generationLockedAt: '' },
      }),
    );
    expect(campaignGenerationQueue.add).not.toHaveBeenCalled();
  });

  it('marks stale generation failed when automatic attempts are exhausted', async () => {
    const now = new Date('2026-07-01T00:00:00.000Z');
    const campaignId = new Types.ObjectId();
    campaignModel.find.mockReturnValueOnce(
      query([
        {
          _id: campaignId,
          userId,
          status: CampaignStatus.GENERATING,
          generationAttemptId: 'old-attempt',
          generationLockedAt: new Date(now.getTime() - 20 * 60 * 1000),
          generationAttempts: 3,
          generationRequest: makeGenerationRequest(),
        },
      ]),
    );

    const result = await service.recoverStaleCampaignGenerations({ now });

    expect(result).toEqual({ scanned: 1, requeued: 0, failed: 1 });
    expect(campaignModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: campaignId,
        userId,
        status: CampaignStatus.GENERATING,
        generationAttemptId: 'old-attempt',
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: CampaignStatus.FAILED,
          generationError: expect.stringContaining('stalled after 3 attempts'),
          failedAt: now,
        }),
      }),
    );
    expect(campaignGenerationQueue.add).not.toHaveBeenCalled();
  });

  it('marks recovery failed if the recovery queue add fails', async () => {
    const now = new Date('2026-07-01T00:00:00.000Z');
    const campaignId = new Types.ObjectId();
    const stale = {
      _id: campaignId,
      userId,
      status: CampaignStatus.GENERATING,
      generationAttemptId: 'old-attempt',
      generationLockedAt: new Date(now.getTime() - 20 * 60 * 1000),
      generationAttempts: 1,
      generationRequest: makeGenerationRequest(),
    };
    campaignModel.find.mockReturnValueOnce(query([stale]));
    campaignModel.findOneAndUpdate.mockResolvedValueOnce({
      ...stale,
      generationAttemptId: 'new-attempt',
    });
    campaignGenerationQueue.add.mockRejectedValueOnce(new Error('redis unavailable'));

    const result = await service.recoverStaleCampaignGenerations({ now });

    expect(result).toEqual({ scanned: 1, requeued: 0, failed: 1 });
    expect(campaignModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: campaignId,
        userId,
        status: CampaignStatus.GENERATING,
        generationAttemptId: expect.any(String),
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: CampaignStatus.FAILED,
          generationError: 'Campaign generation recovery could not be queued',
          failedAt: now,
        }),
        $unset: { generationAttemptId: '', generationLockedAt: '' },
      }),
    );
  });

  it('manual retry consumes quota and enqueues a fresh generation attempt', async () => {
    const campaignId = new Types.ObjectId();
    const campaign = makeCampaign(campaignId, new Types.ObjectId(), []);
    campaign.status = CampaignStatus.FAILED;
    campaign.generationRequest = makeGenerationRequest();
    const generating = {
      ...campaign,
      status: CampaignStatus.GENERATING,
      generationAttemptId: 'retry-attempt',
    };
    jest
      .spyOn(service as any, 'requireCampaign')
      .mockResolvedValueOnce(campaign)
      .mockResolvedValueOnce(generating);
    jest.spyOn(service as any, 'serializeCampaign').mockResolvedValue({
      status: CampaignStatus.GENERATING,
    });
    campaignModel.findOneAndUpdate.mockResolvedValueOnce(generating);

    const result = await service.retryGeneration(userId, String(campaignId));

    expect(result).toEqual({ status: CampaignStatus.GENERATING });
    expect(campaignModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: campaignId,
        userId,
        status: CampaignStatus.FAILED,
        generationRequest: { $exists: true },
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: CampaignStatus.GENERATING,
          generationAttemptId: expect.any(String),
          generationLockedAt: expect.any(Date),
          generationAttempts: 1,
        }),
      }),
      { new: true },
    );
    expect(llmQuotaUsageModel.findOneAndUpdate).toHaveBeenCalled();
    expect(campaignGenerationQueue.add).toHaveBeenCalledWith(
      CAMPAIGN_GENERATION_JOB,
      expect.objectContaining({
        campaignId: String(campaignId),
        userId,
        generationAttemptId: expect.any(String),
      }),
      expect.objectContaining({ removeOnFail: false }),
    );
  });

  it('debug simulation marks a campaign as a stale claimed generation without queueing', async () => {
    const campaignId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const campaign = makeCampaign(campaignId, contactId);
    const updated = {
      ...campaign,
      status: CampaignStatus.GENERATING,
      generationAttemptId: 'debug-attempt',
    };
    jest.spyOn(service as any, 'requireCampaign').mockResolvedValue(campaign);
    jest.spyOn(service as any, 'findDefaultCampaignTemplate').mockResolvedValue({
      _id: new Types.ObjectId(),
      defaultMaxSteps: 3,
      steps: [{ order: 1 }],
    });
    jest.spyOn(service as any, 'serializeCampaign').mockResolvedValue({
      status: CampaignStatus.GENERATING,
      generationError: 'Debug: simulated worker crash after generation claim',
    });
    contactsService.findOwnedByIds.mockResolvedValue([
      { _id: contactId, name: 'Ada Lovelace', email: 'ada@example.com' },
    ]);
    campaignModel.findOneAndUpdate.mockResolvedValueOnce(updated);

    const result = await service.debugSimulateGenerationWorkerCrash(
      userId,
      String(campaignId),
    );

    expect(result).toEqual({
      status: CampaignStatus.GENERATING,
      generationError: 'Debug: simulated worker crash after generation claim',
    });
    expect(campaignModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: campaignId, userId },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: CampaignStatus.GENERATING,
          sequenceSteps: [],
          generationAttemptId: expect.stringMatching(/^debug-/),
          generationLockedAt: expect.any(Date),
          generationAttempts: 1,
          generationRequest: expect.objectContaining({
            name: 'Founder outreach',
            groupIds: [],
            contactIds: [String(contactId)],
          }),
          generationError: 'Debug: simulated worker crash after generation claim',
        }),
        $unset: { failedAt: '' },
      }),
      { new: true },
    );
    expect(campaignGenerationQueue.add).not.toHaveBeenCalled();
    expect(llmQuotaUsageModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('debug recovery trigger runs stale generation recovery and returns the campaign', async () => {
    const campaignId = new Types.ObjectId();
    const campaign = makeCampaign(campaignId, new Types.ObjectId());
    jest
      .spyOn(service as any, 'requireCampaign')
      .mockResolvedValueOnce(campaign);
    jest.spyOn(service, 'recoverStaleCampaignGenerations').mockResolvedValue({
      scanned: 1,
      requeued: 1,
      failed: 0,
    });
    jest.spyOn(service as any, 'serializeCampaign').mockResolvedValue({
      _id: String(campaignId),
    });

    const result = await service.debugRecoverGeneration(userId, String(campaignId));

    expect(service.recoverStaleCampaignGenerations).toHaveBeenCalledWith({
      userId,
      campaignId: String(campaignId),
      limit: 1,
    });
    expect(result).toEqual({
      recovery: { scanned: 1, requeued: 1, failed: 0 },
      campaign: { _id: String(campaignId) },
    });
  });

  it('marks a campaign failed when launch side effects fail after claim', async () => {
    const campaignId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const campaign = makeCampaign(campaignId, contactId);
    const claimed = { ...campaign, status: CampaignStatus.LAUNCHING };
    jest.spyOn(service as any, 'requireCampaign').mockResolvedValue(campaign);
    jest.spyOn(service as any, 'resolveRecipients').mockResolvedValue([
      {
        contactId: String(contactId),
        direct: true,
        sourceGroupIds: [],
        snapshot: {
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          company: 'Acme',
        },
      },
    ]);
    jest
      .spyOn(service as any, 'snapshotRecipients')
      .mockRejectedValue(new Error('database write failed'));
    campaignModel.findOneAndUpdate.mockResolvedValueOnce(claimed);

    await expect(service.launch(userId, String(campaignId))).rejects.toThrow(
      'database write failed',
    );

    expect(campaignModel.updateOne).toHaveBeenCalledWith(
      { _id: campaignId, userId, status: CampaignStatus.LAUNCHING },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: CampaignStatus.FAILED,
          generationError: 'Campaign launch failed',
          failedAt: expect.any(Date),
          lastAttemptedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('allows stale processing outbox rows to be reclaimed', async () => {
    const campaignId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const outboxId = new Types.ObjectId();
    const lockedAt = new Date(Date.now() - 20 * 60 * 1000);
    const claimed = makeOutbox(outboxId, campaignId, contactId, lockedAt);
    outboxModel.findById.mockReturnValueOnce(query(claimed));
    outboxModel.findOneAndUpdate.mockResolvedValueOnce(claimed);
    jest.spyOn(service as any, 'requireCampaign').mockResolvedValue(
      makeCampaign(campaignId, contactId),
    );
    jest.spyOn(service as any, 'markCampaignCompleteIfDone').mockResolvedValue(undefined);

    await service.processOutboxMessage(String(outboxId));

    expect(outboxModel.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
      _id: outboxId,
      $or: [
        { status: { $in: [OutboxStatus.QUEUED, OutboxStatus.FAILED] } },
        {
          status: OutboxStatus.PROCESSING,
          lockedAt: { $lte: expect.any(Date) },
        },
      ],
    });
    expect(outboxModel.updateOne).toHaveBeenCalledWith(
      { _id: outboxId },
      expect.objectContaining({
        $set: expect.objectContaining({ status: OutboxStatus.SENT }),
      }),
    );
  });

  it('does not complete a campaign while failed outbox rows remain', async () => {
    const campaignId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const outboxId = new Types.ObjectId();
    const claimed = makeOutbox(outboxId, campaignId, contactId, new Date());
    outboxModel.findById.mockReturnValueOnce(query(claimed));
    outboxModel.findOneAndUpdate.mockResolvedValueOnce(claimed);
    outboxModel.countDocuments.mockResolvedValueOnce(1);
    jest.spyOn(service as any, 'requireCampaign').mockResolvedValue(
      makeCampaign(campaignId, contactId),
    );

    await service.processOutboxMessage(String(outboxId));

    expect(outboxModel.countDocuments).toHaveBeenCalledWith({
      userId,
      campaignId,
      status: {
        $in: [OutboxStatus.QUEUED, OutboxStatus.PROCESSING, OutboxStatus.FAILED],
      },
    });
    expect(campaignModel.updateOne).not.toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        _id: String(campaignId),
        status: CampaignStatus.RUNNING,
      }),
      expect.objectContaining({
        $set: expect.objectContaining({ status: CampaignStatus.COMPLETED }),
      }),
    );
  });

  it('does not process fresh processing outbox rows', async () => {
    const campaignId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const outboxId = new Types.ObjectId();
    outboxModel.findById.mockReturnValueOnce(
      query(makeOutbox(outboxId, campaignId, contactId, new Date())),
    );
    outboxModel.findOneAndUpdate.mockResolvedValueOnce(null);
    const requireCampaign = jest.spyOn(service as any, 'requireCampaign');

    await service.processOutboxMessage(String(outboxId));

    expect(requireCampaign).not.toHaveBeenCalled();
    expect(outboxModel.updateOne).not.toHaveBeenCalled();
  });

  it('marks failed outbox rows with inspectable failure metadata', async () => {
    const campaignId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const outboxId = new Types.ObjectId();
    const current = {
      ...makeOutbox(outboxId, campaignId, contactId, new Date()),
      status: OutboxStatus.QUEUED,
    };
    const campaign = makeCampaign(campaignId, contactId);
    campaign.sequenceSteps = [
      {
        stepId: 'other-step',
        order: 1,
        delayMinutes: 0,
        subjectTemplate: 'Different step for {{company}}',
        promptTemplate: 'Different body for {{company}}',
      },
    ];
    outboxModel.findById.mockReturnValueOnce(query(current));
    outboxModel.findOneAndUpdate.mockResolvedValueOnce(current);
    jest.spyOn(service as any, 'requireCampaign').mockResolvedValue(campaign);

    await expect(service.processOutboxMessage(String(outboxId))).rejects.toThrow(
      'Sequence step no longer exists',
    );

    expect(outboxModel.updateOne).toHaveBeenCalledWith(
      { _id: outboxId },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: OutboxStatus.FAILED,
          error: 'Sequence step no longer exists',
          failedAt: expect.any(Date),
          lastAttemptedAt: expect.any(Date),
        }),
        $unset: { lockedAt: '' },
      }),
    );
  });

  it('dispatches due queued outbox rows with deterministic queue job IDs', async () => {
    const now = new Date('2026-07-01T00:00:00.000Z');
    const campaignId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const outboxId = new Types.ObjectId();
    outboxModel.find.mockReturnValueOnce(
      query([
        {
          _id: outboxId,
          campaignId,
          contactId,
          stepId: 'step-1',
          status: OutboxStatus.QUEUED,
          scheduledFor: new Date(now.getTime() - 1000),
        },
      ]),
    );
    sequenceQueue.add.mockResolvedValueOnce(undefined);

    const result = await service.dispatchDueOutboxMessages(now);

    expect(result).toEqual({ enqueued: 1 });
    expect(outboxModel.find).toHaveBeenCalledWith({
      status: OutboxStatus.QUEUED,
      $or: [
        { scheduledFor: { $lte: now } },
        { scheduledFor: { $exists: false } },
      ],
    });
    expect(sequenceQueue.add).toHaveBeenCalledWith(
      SEQUENCE_EMAIL_JOB,
      { outboxId: String(outboxId) },
      expect.objectContaining({
        jobId: `${String(campaignId)}__step-1__${String(contactId)}`,
        delay: 0,
        removeOnFail: false,
      }),
    );
  });

  it('does not dispatch non-queued outbox rows', async () => {
    const now = new Date('2026-07-01T00:00:00.000Z');
    outboxModel.find.mockReturnValueOnce(query([]));

    const result = await service.dispatchDueOutboxMessages(now);

    expect(result).toEqual({ enqueued: 0 });
    expect(outboxModel.find.mock.calls[0][0]).toMatchObject({
      status: OutboxStatus.QUEUED,
    });
    expect(sequenceQueue.add).not.toHaveBeenCalled();
  });

  it('updates one draft sequence step without replacing the whole campaign flow', async () => {
    const campaignId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const campaign = makeCampaign(campaignId, contactId);
    campaign.sequenceSteps = [
      ...campaign.sequenceSteps,
      {
        stepId: 'step-2',
        order: 2,
        delayMinutes: 4320,
        subjectTemplate: 'Following up on {{company}}',
        promptTemplate: 'Hi {{first_name}}, following up about {{company}}.',
      },
    ];
    const updated = makeCampaign(campaignId, contactId);
    updated.sequenceSteps = [
      campaign.sequenceSteps[0],
      {
        ...campaign.sequenceSteps[1],
        subjectTemplate: 'Quick follow-up for {{company}}',
        promptTemplate: '<p>Hi {{first_name}}, still worth a look at {{company}}?</p>',
      },
    ];
    updated.promptTemplate = updated.sequenceSteps[0].promptTemplate;

    jest.spyOn(service as any, 'requireCampaign').mockResolvedValue(campaign);
    campaignModel.findOneAndUpdate.mockResolvedValueOnce(updated);
    contactsService.findOwnedByIds.mockResolvedValue([]);

    const result = await service.updateSequenceStep(userId, String(campaignId), 'step-2', {
      subjectTemplate: 'Quick follow-up for {{company}}',
      promptTemplate: '<p>Hi {{first_name}}, still worth a look at {{company}}?</p>',
    });

    expect(campaignModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: campaignId,
        userId,
        'sequenceSteps.stepId': 'step-2',
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          sequenceSteps: expect.arrayContaining([
            expect.objectContaining({
              stepId: 'step-2',
              subjectTemplate: 'Quick follow-up for {{company}}',
              promptTemplate:
                '<p>Hi {{first_name}}, still worth a look at {{company}}?</p>',
            }),
          ]),
        }),
      }),
      { new: true },
    );
    expect(result.sequenceSteps[1]).toMatchObject({
      stepId: 'step-2',
      subjectTemplate: 'Quick follow-up for {{company}}',
    });
  });

  it('returns one regenerated sequence step proposal without mutating the campaign', async () => {
    const campaignId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const campaign = makeCampaign(campaignId, contactId);

    jest.spyOn(service as any, 'requireCampaign').mockResolvedValue(campaign);
    llm.complete.mockResolvedValue(
      JSON.stringify({
        subjectTemplate: 'Fresh idea for {{company}}',
        promptTemplate: 'Hi {{first_name}}, a sharper idea for {{company}}.',
      }),
    );

    const result = await service.regenerateSequenceStep(
      userId,
      String(campaignId),
      'step-1',
    );

    expect(llm.complete).toHaveBeenCalledWith(
      expect.stringContaining('Regenerate exactly one outreach sequence email step.'),
    );
    expect(campaignModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(result).toEqual({
      step: expect.objectContaining({
        stepId: 'step-1',
        order: 1,
        delayMinutes: 0,
        subjectTemplate: 'Fresh idea for {{company}}',
        promptTemplate: 'Hi {{first_name}}, a sharper idea for {{company}}.',
      }),
    });
  });

  it('keeps safe validation errors for direct generation failures', async () => {
    const campaignId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    const campaign = makeCampaign(campaignId, contactId);
    (campaign as any).promptTemplate = undefined;
    campaign.sequenceSteps = [];
    jest.spyOn(service as any, 'requireCampaign').mockResolvedValue(campaign);
    contactsService.findOwnedByIds.mockResolvedValue([
      { _id: contactId, name: 'Ada Lovelace', email: 'ada@example.com' },
    ]);
    campaignModel.findOneAndUpdate.mockResolvedValueOnce({ _id: campaignId });

    const result = await service.generateForContact(
      userId,
      String(campaignId),
      String(contactId),
    );

    expect(result).toEqual({
      status: GenerationStatus.FAILED,
      error: 'Campaign has no prompt template',
    });
  });
});

function query<T>(value: T) {
  return {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

function makeCampaign(
  campaignId: Types.ObjectId,
  contactId: Types.ObjectId,
  contacts: any[] = [
    {
      contactId,
      status: GenerationStatus.NOT_GENERATED,
    },
  ],
) {
  const campaign: any = {
    _id: campaignId,
    userId: 'user-1',
    name: 'Founder outreach',
    status: CampaignStatus.DRAFT,
    promptTemplate: 'Hi {{first_name}}, quick idea for {{company}}.',
    directContactIds: [contactId],
    targetGroupIds: [],
    contacts,
    sequenceSteps: [
      {
        stepId: 'step-1',
        order: 1,
        delayMinutes: 0,
        subjectTemplate: 'Idea for {{company}}',
        promptTemplate: 'Hi {{first_name}}, quick idea for {{company}}.',
      },
    ],
    save: jest.fn(),
    toObject: jest.fn(),
  };
  campaign.toObject.mockImplementation(() => ({
    _id: campaign._id,
    userId: campaign.userId,
    name: campaign.name,
    status: campaign.status,
    promptTemplate: campaign.promptTemplate,
    directContactIds: campaign.directContactIds,
    targetGroupIds: campaign.targetGroupIds,
    contacts: campaign.contacts,
    sequenceSteps: campaign.sequenceSteps,
    generationError: campaign.generationError,
  }));
  return campaign;
}

function makeGenerationRequest() {
  return {
    name: 'Generated sequence',
    templateId: 'cold-intro',
    goal: 'Book calls',
    audienceDescription: 'Founders',
    tone: 'direct',
    maxSteps: 3,
    groupIds: [],
    contactIds: [],
  };
}

function makeOutbox(
  outboxId: Types.ObjectId,
  campaignId: Types.ObjectId,
  contactId: Types.ObjectId,
  lockedAt: Date,
) {
  return {
    _id: outboxId,
    userId: 'user-1',
    campaignId,
    contactId,
    stepId: 'step-1',
    stepOrder: 1,
    recipient: {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      company: 'Acme',
    },
    status: OutboxStatus.PROCESSING,
    lockedAt,
  };
}
