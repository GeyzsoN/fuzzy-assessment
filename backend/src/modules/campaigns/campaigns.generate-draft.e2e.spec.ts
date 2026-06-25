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
    listTemplates: jest.fn(),
    generateDraft: jest.fn(),
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
    campaignsService.listTemplates.mockResolvedValue(templateResponse);
    campaignsService.generateDraft.mockResolvedValue(draftResponse);

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
    });
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
