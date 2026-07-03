import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CampaignsController } from './campaigns.controller';
import { CampaignTemplatesController } from './campaign-templates.controller';
import { CampaignsService } from './campaigns.service';

describe('campaign draft generation endpoints (e2e)', () => {
  let app: INestApplication;
  const campaignsService = {
    create: jest.fn(),
    listTemplates: jest.fn(),
    generateDraft: jest.fn(),
    retryGeneration: jest.fn(),
    debugSimulateGenerationWorkerCrash: jest.fn(),
    debugRecoverGeneration: jest.fn(),
    updateSequenceStep: jest.fn(),
    regenerateSequenceStep: jest.fn(),
  };

  const templateResponse = [
    {
      _id: '64b000000000000000000001',
      id: '64b000000000000000000001',
      key: 'cold-intro',
      name: 'Cold Intro Sequence',
      description: 'A direct first-touch sequence.',
      defaultMaxSteps: 4,
      promptTemplateKey: 'sequence-draft-v1',
      steps: [
        {
          order: 1,
          delayDays: 0,
          subjectTemplate: 'Idea for {{company}}',
          promptTemplate: 'Hi {{first_name}}, checking in about {{company}}.',
        },
        {
          order: 2,
          delayDays: 3,
          subjectTemplate: 'Following up on {{company}}',
          promptTemplate: 'Hi {{first_name}}, following up on my note.',
        },
        {
          order: 3,
          delayDays: 7,
          subjectTemplate: 'Worth closing the loop?',
          promptTemplate: 'Hi {{first_name}}, should I close the loop?',
        },
        {
          order: 4,
          delayDays: 14,
          subjectTemplate: 'Final note for now',
          promptTemplate: 'Hi {{first_name}}, final note from me for now.',
        },
      ],
    },
  ];

  const draftResponse = {
    _id: '64c000000000000000000001',
    userId: 'user-1',
    name: 'Generated Founder Sequence',
    status: 'generating',
    targetGroupIds: ['64a000000000000000000001'],
    directContactIds: ['64a000000000000000000002'],
    sequenceSteps: [],
    contacts: [],
    recipients: [],
    createdAt: '2026-06-25T00:00:00.000Z',
    updatedAt: '2026-06-25T00:00:00.000Z',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    campaignsService.create.mockResolvedValue(draftResponse);
    campaignsService.listTemplates.mockResolvedValue(templateResponse);
    campaignsService.generateDraft.mockResolvedValue(draftResponse);
    campaignsService.retryGeneration.mockResolvedValue(draftResponse);
    campaignsService.debugSimulateGenerationWorkerCrash.mockResolvedValue({
      ...draftResponse,
      generationError: 'Debug: simulated worker crash after generation claim',
    });
    campaignsService.debugRecoverGeneration.mockResolvedValue({
      recovery: { scanned: 1, requeued: 1, failed: 0 },
      campaign: draftResponse,
    });
    campaignsService.updateSequenceStep.mockResolvedValue(draftResponse);
    campaignsService.regenerateSequenceStep.mockResolvedValue({
      step: {
        stepId: 'step-1',
        order: 1,
        delayMinutes: 0,
        subjectTemplate: 'Updated note for {{company}}',
        promptTemplate: 'Hi {{first_name}}, updated note for {{company}}.',
      },
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [CampaignsController, CampaignTemplatesController],
      providers: [{ provide: CampaignsService, useValue: campaignsService }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires auth for GET /campaign-templates', async () => {
    await request(app.getHttpServer()).get('/campaign-templates').expect(401);
  });

  it('returns read-only campaign templates with four-step skeleton support', async () => {
    const res = await request(app.getHttpServer())
      .get('/campaign-templates')
      .set('x-user-id', 'user-1')
      .expect(200);

    expect(res.body).toEqual(templateResponse);
    expect(res.body[0]).toMatchObject({
      id: expect.any(String),
      key: 'cold-intro',
      defaultMaxSteps: 4,
    });
    expect(res.body[0].steps).toHaveLength(4);
    expect(res.body[0].steps[3]).toMatchObject({
      order: 4,
      delayDays: 14,
      promptTemplate: expect.stringContaining('{{first_name}}'),
    });
  });

  it('requires auth for POST /campaigns/generate-draft', async () => {
    await request(app.getHttpServer())
      .post('/campaigns/generate-draft')
      .send(validGenerateDraftBody())
      .expect(401);
  });

  it('validates required draft generation fields before service execution', async () => {
    await request(app.getHttpServer())
      .post('/campaigns/generate-draft')
      .set('x-user-id', 'user-1')
      .send({
        name: 'Missing goal',
        audienceDescription: 'Founders',
        templateId: 'cold-intro',
      })
      .expect(400);

    expect(campaignsService.generateDraft).not.toHaveBeenCalled();
  });

  it('rejects maxSteps above four before service execution', async () => {
    await request(app.getHttpServer())
      .post('/campaigns/generate-draft')
      .set('x-user-id', 'user-1')
      .send({ ...validGenerateDraftBody(), maxSteps: 5 })
      .expect(400);

    expect(campaignsService.generateDraft).not.toHaveBeenCalled();
  });

  it('strips unknown request fields before calling the service', async () => {
    await request(app.getHttpServer())
      .post('/campaigns/generate-draft')
      .set('x-user-id', 'user-1')
      .send({
        ...validGenerateDraftBody(),
        ignoredField: 'should not reach service',
      })
      .expect(201);

    expect(campaignsService.generateDraft).toHaveBeenCalledWith('user-1', {
      ...validGenerateDraftBody(),
    }, undefined);
  });

  it('forwards Idempotency-Key for POST /campaigns/generate-draft', async () => {
    await request(app.getHttpServer())
      .post('/campaigns/generate-draft')
      .set('x-user-id', 'user-1')
      .set('Idempotency-Key', 'draft-submit-key')
      .send(validGenerateDraftBody())
      .expect(201);

    expect(campaignsService.generateDraft).toHaveBeenCalledWith(
      'user-1',
      validGenerateDraftBody(),
      'draft-submit-key',
    );
  });

  it('forwards Idempotency-Key for POST /campaigns', async () => {
    const body = {
      name: 'Manual founder sequence',
      promptTemplate: 'Hi {{first_name}}, checking in about {{company}}.',
      contactIds: ['64a000000000000000000002'],
    };

    await request(app.getHttpServer())
      .post('/campaigns')
      .set('x-user-id', 'user-1')
      .set('Idempotency-Key', 'create-submit-key')
      .send(body)
      .expect(201);

    expect(campaignsService.create).toHaveBeenCalledWith(
      'user-1',
      body,
      'create-submit-key',
    );
  });

  it('returns a generating campaign response while the LLM job runs asynchronously', async () => {
    const res = await request(app.getHttpServer())
      .post('/campaigns/generate-draft')
      .set('x-user-id', 'user-1')
      .send(validGenerateDraftBody())
      .expect(201);

    expect(res.body).toMatchObject({
      _id: expect.any(String),
      userId: 'user-1',
      name: 'Generated Founder Sequence',
      status: 'generating',
      targetGroupIds: ['64a000000000000000000001'],
      directContactIds: ['64a000000000000000000002'],
      contacts: [],
      recipients: [],
    });
    expect(res.body.sequenceSteps).toEqual([]);
  });

  it('requires auth for POST /campaigns/:id/retry-generation', async () => {
    await request(app.getHttpServer())
      .post('/campaigns/64c000000000000000000001/retry-generation')
      .expect(401);
  });

  it('forwards retry generation requests to the service', async () => {
    await request(app.getHttpServer())
      .post('/campaigns/64c000000000000000000001/retry-generation')
      .set('x-user-id', 'user-1')
      .expect(201);

    expect(campaignsService.retryGeneration).toHaveBeenCalledWith(
      'user-1',
      '64c000000000000000000001',
    );
  });

  it('returns 400 when retry generation has no recoverable payload', async () => {
    campaignsService.retryGeneration.mockRejectedValueOnce(
      new BadRequestException(
        'Campaign generation cannot be retried because recovery metadata is missing',
      ),
    );

    await request(app.getHttpServer())
      .post('/campaigns/64c000000000000000000001/retry-generation')
      .set('x-user-id', 'user-1')
      .expect(400);
  });

  it('requires auth for debug worker-crash simulation', async () => {
    await request(app.getHttpServer())
      .post(
        '/campaigns/64c000000000000000000001/debug/simulate-generation-worker-crash',
      )
      .expect(401);
  });

  it('forwards debug worker-crash simulation requests to the service', async () => {
    await request(app.getHttpServer())
      .post(
        '/campaigns/64c000000000000000000001/debug/simulate-generation-worker-crash',
      )
      .set('x-user-id', 'user-1')
      .expect(201);

    expect(
      campaignsService.debugSimulateGenerationWorkerCrash,
    ).toHaveBeenCalledWith('user-1', '64c000000000000000000001');
  });

  it('forwards debug recovery checks to the service', async () => {
    const res = await request(app.getHttpServer())
      .post('/campaigns/64c000000000000000000001/debug/recover-generation')
      .set('x-user-id', 'user-1')
      .expect(201);

    expect(campaignsService.debugRecoverGeneration).toHaveBeenCalledWith(
      'user-1',
      '64c000000000000000000001',
    );
    expect(res.body.recovery).toEqual({ scanned: 1, requeued: 1, failed: 0 });
  });

  it('validates and forwards sequence step edits', async () => {
    const body = {
      delayMinutes: 1440,
      subjectTemplate: 'Updated note for {{company}}',
      promptTemplate: '<p>Hi {{first_name}}, updated note for {{company}}.</p>',
    };

    await request(app.getHttpServer())
      .patch('/campaigns/64c000000000000000000001/sequence-steps/step-1')
      .set('x-user-id', 'user-1')
      .send(body)
      .expect(200);

    expect(campaignsService.updateSequenceStep).toHaveBeenCalledWith(
      'user-1',
      '64c000000000000000000001',
      'step-1',
      body,
    );
  });

  it('validates and forwards one-step regeneration requests', async () => {
    const body = { instructions: 'Make it more concise.' };

    const res = await request(app.getHttpServer())
      .post('/campaigns/64c000000000000000000001/sequence-steps/step-1/regenerate')
      .set('x-user-id', 'user-1')
      .send(body)
      .expect(201);

    expect(campaignsService.regenerateSequenceStep).toHaveBeenCalledWith(
      'user-1',
      '64c000000000000000000001',
      'step-1',
      body,
    );
    expect(res.body).toMatchObject({
      step: {
        stepId: 'step-1',
        subjectTemplate: 'Updated note for {{company}}',
      },
    });
  });

  it('surfaces service validation errors as endpoint errors', async () => {
    campaignsService.generateDraft.mockRejectedValueOnce(
      new BadRequestException('LLM returned invalid campaign draft JSON'),
    );

    await request(app.getHttpServer())
      .post('/campaigns/generate-draft')
      .set('x-user-id', 'user-1')
      .send(validGenerateDraftBody())
      .expect(400);
  });
});

function validGenerateDraftBody() {
  return {
    name: 'Generated Founder Sequence',
    goal: 'Book intro calls for workflow automation',
    audienceDescription: 'Founders and revenue leaders',
    templateId: 'cold-intro',
    tone: 'concise and direct',
    maxSteps: 4,
    groupIds: ['64a000000000000000000001'],
    contactIds: ['64a000000000000000000002'],
  };
}
