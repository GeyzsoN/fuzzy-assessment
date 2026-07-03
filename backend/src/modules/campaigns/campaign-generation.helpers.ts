import { BadRequestException } from '@nestjs/common';
import { SequenceStep } from './schemas/campaign.schema';
import { CampaignTemplate, PromptTemplate } from './schemas/campaign-template.schema';
import { SequenceStepDto } from './dtos/create-campaign.dto';

export const MAX_SEQUENCE_STEPS = 4;
const ALLOWED_PLACEHOLDERS = new Set([
  'name',
  'first_name',
  'last_name',
  'email',
  'company',
  'title',
]);
const MANAGED_PROMPT_FIELDS = new Set([
  'goal',
  'audienceDescription',
  'tone',
  'maxSteps',
  'baseStepsJson',
]);
const PLACEHOLDER_RE = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;

type TemplateValidationOptions = {
  requirePlaceholder?: boolean;
};

type HydrationData = Record<string, unknown>;

export function normalizeSequenceSteps(
  rawSteps?: SequenceStepDto[] | SequenceStep[],
  promptTemplate?: string,
): SequenceStep[] {
  const steps = rawSteps || [];
  if (!steps.length) {
    if (!promptTemplate) {
      throw new BadRequestException(
        'Campaign requires either promptTemplate or sequenceSteps',
      );
    }
    return [
      {
        stepId: 'step-1',
        order: 1,
        delayMinutes: 0,
        subjectTemplate: 'Intro for {{company}}',
        promptTemplate,
      },
    ];
  }

  if (steps.length > MAX_SEQUENCE_STEPS) {
    throw new BadRequestException(
      `Campaign sequences can include at most ${MAX_SEQUENCE_STEPS} steps`,
    );
  }

  const normalized = steps
    .map((step, index) => ({
      stepId: step.stepId || `step-${step.order || index + 1}`,
      order: Number(step.order),
      delayMinutes: Number(step.delayMinutes || 0),
      subjectTemplate: step.subjectTemplate,
      promptTemplate: step.promptTemplate,
    }))
    .sort((a, b) => a.order - b.order);

  const orders = new Set(normalized.map((step) => step.order));
  const stepIds = new Set(normalized.map((step) => step.stepId));
  if (orders.size !== normalized.length || stepIds.size !== normalized.length) {
    throw new BadRequestException('Sequence steps must have unique order/stepId');
  }
  if (normalized[0].order !== 1) {
    throw new BadRequestException('Sequence steps must start at order 1');
  }
  normalized.forEach((step, index) => {
    if (step.order !== index + 1) {
      throw new BadRequestException('Sequence step orders must be contiguous');
    }
    if (!step.subjectTemplate || !step.promptTemplate) {
      throw new BadRequestException(
        'Each sequence step needs subjectTemplate and promptTemplate',
      );
    }
    assertAllowedContactPlaceholders(step.subjectTemplate, {
      requirePlaceholder: false,
    });
    assertAllowedContactPlaceholders(step.promptTemplate, {
      requirePlaceholder: true,
    });
  });

  return normalized;
}

export function buildPiiSafeGenerationPrompt(template: string): string {
  assertAllowedContactPlaceholders(template, { requirePlaceholder: true });
  return [
    'Write the outreach message requested below.',
    'Do not invent or replace contact data.',
    'Keep placeholders exactly as placeholders, such as {{name}}, {{company}}, and {{title}}.',
    'Return only the message body text.',
    '',
    'Template:',
    template,
  ].join('\n');
}

export function hydrateLlmOutput(output: string, data: HydrationData): string {
  const trimmed = (output || '').trim();
  if (!trimmed) {
    throw new BadRequestException('LLM returned an empty message');
  }
  return hydrateContactPlaceholders(trimmed, data, { requirePlaceholder: true });
}

export function hydrateContactPlaceholders(
  template: string,
  data: HydrationData,
  options: TemplateValidationOptions = { requirePlaceholder: true },
): string {
  assertAllowedContactPlaceholders(template, options);
  return template.replace(PLACEHOLDER_RE, (_match, key) => {
    const value = resolvePlaceholderValue(key, data);
    if (value === undefined || value === null || value === '') {
      throw new BadRequestException(`Missing template value: ${key}`);
    }
    return String(value);
  });
}

function resolvePlaceholderValue(key: string, data: HydrationData) {
  if (key === 'first_name') {
    return splitName(data.name).firstName;
  }
  if (key === 'last_name') {
    return splitName(data.name).lastName;
  }
  return data[key];
}

function splitName(value: unknown) {
  const parts = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return {
    firstName: parts[0],
    lastName: parts.length > 1 ? parts[parts.length - 1] : parts[0],
  };
}

export function assertAllowedContactPlaceholders(
  template: string,
  options: TemplateValidationOptions = { requirePlaceholder: true },
) {
  const keys: string[] = [];
  PLACEHOLDER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER_RE.exec(template)) !== null) {
    keys.push(match[1]);
    if (!ALLOWED_PLACEHOLDERS.has(match[1])) {
      throw new BadRequestException(`Unsupported template placeholder: ${match[1]}`);
    }
  }

  if (options.requirePlaceholder && keys.length === 0) {
    throw new BadRequestException(
      'Template must include at least one allowed placeholder',
    );
  }

  const stripped = template.replace(PLACEHOLDER_RE, '');
  if (/{{|}}/.test(stripped)) {
    throw new BadRequestException('Malformed template placeholders');
  }
}

export function scrubUserText(value?: string): string {
  return (value || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\+?\d(?:[\s().-]*\d){7,}/g, '[phone]')
    .trim();
}

export function buildCampaignDraftPrompt(input: {
  name: string;
  goal: string;
  audienceDescription: string;
  tone?: string;
  maxSteps: number;
  campaignTemplate: CampaignTemplate;
  promptTemplate: PromptTemplate;
}): string {
  const maxSteps = clampMaxSteps(input.maxSteps);
  const baseSteps = [...(input.campaignTemplate.steps || [])]
    .sort((a, b) => a.order - b.order)
    .slice(0, maxSteps)
    .map((step) => ({
      order: step.order,
      delayDays: step.delayDays,
      subjectTemplate: step.subjectTemplate,
      promptTemplate: step.promptTemplate,
    }));

  const fields: Record<string, string> = {
    goal: scrubUserText(input.goal),
    audienceDescription: scrubUserText(input.audienceDescription),
    tone: scrubUserText(input.tone || 'professional and concise'),
    maxSteps: String(maxSteps),
    baseStepsJson: JSON.stringify(baseSteps),
  };

  const userPrompt = renderManagedPrompt(input.promptTemplate.userPrompt, fields);
  return [input.promptTemplate.systemPrompt.trim(), userPrompt.trim()]
    .filter(Boolean)
    .join('\n\n');
}

export function parseCampaignDraftResponse(
  raw: string,
  maxSteps: number,
): SequenceStep[] {
  const parsed = parseJsonOnly(raw);
  const steps = Array.isArray(parsed) ? parsed : parsed?.steps;
  if (!Array.isArray(steps)) {
    throw new BadRequestException('LLM draft must include a steps array');
  }
  if (steps.length < 1 || steps.length > clampMaxSteps(maxSteps)) {
    throw new BadRequestException(
      `LLM draft must include between 1 and ${clampMaxSteps(maxSteps)} steps`,
    );
  }

  return normalizeSequenceSteps(
    steps.map((step: any, index: number) => {
      if (containsObviousPii(step?.subjectTemplate || '')) {
        throw new BadRequestException('LLM draft subject included PII');
      }
      if (containsObviousPii(step?.promptTemplate || '')) {
        throw new BadRequestException('LLM draft prompt included PII');
      }
      if (containsGenerationInstruction(step?.promptTemplate || '')) {
        throw new BadRequestException(
          'LLM draft promptTemplate must be actual email copy, not generation instructions',
        );
      }

      const delayDays = Number(step?.delayDays ?? (index === 0 ? 0 : index * 3));
      if (!Number.isFinite(delayDays) || delayDays < 0) {
        throw new BadRequestException('LLM draft delayDays must be non-negative');
      }

      return {
        stepId: `step-${index + 1}`,
        order: Number(step?.order || index + 1),
        delayMinutes: Math.round(delayDays * 24 * 60),
        subjectTemplate: String(step?.subjectTemplate || '').trim(),
        promptTemplate: String(step?.promptTemplate || '').trim(),
      };
    }),
  );
}

export function buildSequenceStepRegenerationPrompt(input: {
  campaignName: string;
  campaignPrompt?: string;
  step: SequenceStep;
  instructions?: string;
}): string {
  return [
    'Regenerate exactly one outreach sequence email step.',
    'Return strict JSON only with this shape:',
    '{"subjectTemplate":"...","promptTemplate":"..."}',
    'Use only these placeholders when needed: {{name}}, {{first_name}}, {{last_name}}, {{email}}, {{company}}, {{title}}.',
    'Keep placeholders as placeholders. Do not include real personal data, URLs, phone numbers, or markdown fences.',
    'The promptTemplate must be actual email body copy, not instructions to write an email.',
    '',
    `Campaign name: ${scrubUserText(input.campaignName)}`,
    `Campaign prompt: ${scrubUserText(input.campaignPrompt || '') || '(none)'}`,
    `Step order: ${input.step.order}`,
    `Delay minutes: ${input.step.delayMinutes}`,
    `Current subjectTemplate: ${scrubUserText(input.step.subjectTemplate)}`,
    `Current promptTemplate: ${scrubUserText(input.step.promptTemplate)}`,
    input.instructions
      ? `Additional revision instructions: ${scrubUserText(input.instructions)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function parseSequenceStepRegenerationResponse(
  raw: string,
  currentStep: SequenceStep,
): SequenceStep {
  const parsed = parseJsonOnly(raw);
  const candidate = Array.isArray(parsed?.steps) ? parsed.steps[0] : parsed;
  const subjectTemplate = String(candidate?.subjectTemplate || '').trim();
  const promptTemplate = String(
    candidate?.promptTemplate || candidate?.bodyTemplate || candidate?.body || '',
  ).trim();

  if (containsObviousPii(subjectTemplate) || containsObviousPii(promptTemplate)) {
    throw new BadRequestException('LLM regenerated step included PII');
  }
  if (containsGenerationInstruction(promptTemplate)) {
    throw new BadRequestException(
      'LLM regenerated promptTemplate must be actual email copy',
    );
  }

  if (!subjectTemplate || !promptTemplate) {
    throw new BadRequestException(
      'LLM regenerated step needs subjectTemplate and promptTemplate',
    );
  }
  assertAllowedContactPlaceholders(subjectTemplate, { requirePlaceholder: false });
  assertAllowedContactPlaceholders(promptTemplate, { requirePlaceholder: true });

  return {
    ...currentStep,
    subjectTemplate,
    promptTemplate,
  };
}

export function clampMaxSteps(value?: number): number {
  const numeric = Number(value || 1);
  if (!Number.isFinite(numeric)) {
    return 1;
  }
  return Math.min(MAX_SEQUENCE_STEPS, Math.max(1, Math.floor(numeric)));
}

function renderManagedPrompt(template: string, fields: Record<string, string>) {
  const keys: string[] = [];
  const rendered = template.replace(PLACEHOLDER_RE, (_match, key) => {
    keys.push(key);
    if (!MANAGED_PROMPT_FIELDS.has(key)) {
      throw new BadRequestException(`Unsupported prompt template field: ${key}`);
    }
    return fields[key] || '';
  });

  if (keys.length === 0) {
    throw new BadRequestException('Prompt template must include managed fields');
  }
  return rendered;
}

function parseJsonOnly(raw: string): any {
  const trimmed = (raw || '').trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    throw new BadRequestException('LLM returned invalid campaign draft JSON');
  }
}

function containsObviousPii(value: string): boolean {
  return (
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value) ||
    /https?:\/\/\S+/i.test(value) ||
    /\b(?:\+?\d[\s().-]?){8,}\b/.test(value)
  );
}

function containsGenerationInstruction(value: string): boolean {
  const trimmed = String(value || '').trim();
  return (
    /^(write|draft|generate|create)\b/i.test(trimmed) ||
    /\b(return only|preserve placeholders|keep placeholders unchanged)\b/i.test(
      trimmed,
    )
  );
}
