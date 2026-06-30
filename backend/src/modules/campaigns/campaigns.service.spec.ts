import { Types } from 'mongoose';
import { CampaignsService } from './campaigns.service';
import { CampaignStatus, GenerationStatus } from './schemas/campaign.schema';
import { OutboxStatus } from './schemas/outbox-message.schema';

describe('CampaignsService workflow hardening', () => {
  const userId = 'user-1';
  let service: CampaignsService;
  let campaignModel: any;
  let recipientModel: any;
  let outboxModel: any;
  let campaignTemplateModel: any;
  let promptTemplateModel: any;
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
      { _id: campaignId, userId, status: CampaignStatus.GENERATING },
      {
        $set: {
          status: CampaignStatus.FAILED,
          generationError: 'Campaign sequence generation could not be queued',
        },
      },
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
      { _id: campaignId, userId, status: CampaignStatus.GENERATING },
      {
        $set: {
          status: CampaignStatus.FAILED,
          generationError: 'Campaign draft generation could not be queued',
        },
      },
    );
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
      {
        $set: {
          status: CampaignStatus.FAILED,
          generationError: 'Campaign launch failed',
        },
      },
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
  return {
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
    toObject: jest.fn().mockReturnValue({
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
    }),
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
