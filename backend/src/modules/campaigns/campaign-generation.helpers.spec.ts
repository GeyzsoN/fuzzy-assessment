import { BadRequestException } from '@nestjs/common';
import {
  buildCampaignDraftPrompt,
  buildPiiSafeGenerationPrompt,
  hydrateLlmOutput,
  normalizeSequenceSteps,
  parseCampaignDraftResponse,
} from './campaign-generation.helpers';

describe('campaign generation helpers', () => {
  it('rejects sequences longer than four steps', () => {
    expect(() =>
      normalizeSequenceSteps(
        Array.from({ length: 5 }, (_, index) => ({
          order: index + 1,
          delayMinutes: index * 60,
          subjectTemplate: 'Hello {{company}}',
          promptTemplate: 'Hi {{first_name}}, checking in about {{company}}.',
        })),
      ),
    ).toThrow(BadRequestException);
  });

  it('builds PII-safe prompts without contact values', () => {
    const prompt = buildPiiSafeGenerationPrompt(
      'Hi {{first_name}}, I saw your work as {{title}} at {{company}}.',
    );

    expect(prompt).toContain('{{first_name}}');
    expect(prompt).toContain('{{company}}');
    expect(prompt).not.toContain('Alice');
    expect(prompt).not.toContain('alice@example.com');
    expect(prompt).not.toContain('Acme Corp');
  });

  it('hydrates placeholders only after LLM output is returned', () => {
    const hydrated = hydrateLlmOutput(
      'Hi {{first_name}}, saw your work at {{company}}.',
      {
        name: 'Alice Rivera',
        company: 'Acme Corp',
      },
    );

    expect(hydrated).toBe('Hi Alice, saw your work at Acme Corp.');
  });

  it('rejects generated copy that has no placeholder to hydrate', () => {
    expect(() => hydrateLlmOutput('Hi there, quick question.', {})).toThrow(
      BadRequestException,
    );
  });

  it('scrubs obvious PII from campaign draft prompt inputs', () => {
    const prompt = buildCampaignDraftPrompt({
      name: 'Q3 Test',
      goal: 'Email alice@example.com and call +1 415 555 1111',
      audienceDescription: 'People from https://example.com/events',
      tone: 'friendly',
      maxSteps: 2,
      campaignTemplate: {
        key: 'test',
        name: 'Test',
        defaultMaxSteps: 2,
        promptTemplateKey: 'sequence-draft-v1',
        steps: [
          {
            order: 1,
            delayDays: 0,
            subjectTemplate: 'Hello {{company}}',
            promptTemplate: 'Hi {{first_name}}, checking in about {{company}}.',
          },
        ],
      } as any,
      promptTemplate: {
        key: 'sequence-draft-v1',
        name: 'Draft',
        systemPrompt: 'System prompt.',
        userPrompt:
          'Goal: {{goal}}\nAudience: {{audienceDescription}}\nTone: {{tone}}\nSteps: {{baseStepsJson}}\nMax: {{maxSteps}}',
      } as any,
    });

    expect(prompt).toContain('[email]');
    expect(prompt).toContain('[phone]');
    expect(prompt).toContain('[url]');
    expect(prompt).not.toContain('alice@example.com');
    expect(prompt).not.toContain('+[phone]');
    expect(prompt).not.toContain('+1 415 555 1111');
    expect(prompt).toContain('call [phone]');
    expect(prompt).not.toContain('https://example.com/events');
  });

  it('parses valid LLM JSON and converts delay days to minutes', () => {
    const steps = parseCampaignDraftResponse(
      JSON.stringify({
        steps: [
          {
            order: 1,
            delayDays: 0,
            subjectTemplate: 'Idea for {{company}}',
            promptTemplate: 'Hi {{first_name}}, checking in about {{company}}.',
          },
          {
            order: 2,
            delayDays: 2,
            subjectTemplate: 'Following up',
            promptTemplate: 'Hi {{first_name}}, following up on my note.',
          },
        ],
      }),
      4,
    );

    expect(steps).toHaveLength(2);
    expect(steps[1].delayMinutes).toBe(2880);
  });

  it('rejects invalid LLM JSON', () => {
    expect(() => parseCampaignDraftResponse('not json', 4)).toThrow(
      BadRequestException,
    );
  });

  it('rejects LLM draft steps that are instructions instead of email bodies', () => {
    expect(() =>
      parseCampaignDraftResponse(
        JSON.stringify({
          steps: [
            {
              order: 1,
              delayDays: 0,
              subjectTemplate: 'Idea for {{company}}',
              promptTemplate: 'Write a short email to {{name}} at {{company}}.',
            },
          ],
        }),
        4,
      ),
    ).toThrow(BadRequestException);
  });
});
