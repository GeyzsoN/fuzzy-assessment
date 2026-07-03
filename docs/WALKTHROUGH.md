# Mini Outreach Sequencer Walkthrough

This is a quick map for the live review. The required core flow is listed first;
groups, sequences, outbox, Redis/BullMQ, and the campaign wizard are extensions
on top of that core.

Code blocks below are abbreviated excerpts from the referenced files. Open the
linked files during screen-share for the full implementation.

## Core Product Flow

1. The user creates and searches contacts on `/contacts`.
2. The user creates a campaign with a `name` and `promptTemplate`.
3. The user attaches existing contacts to that campaign.
4. The campaign detail page shows attached contacts and their generation status.
5. The user clicks `Generate message` for one contact.
6. The backend interpolates the contact into the prompt template, calls the LLM,
   and persists `pending -> finished` or `pending -> failed`.

## Generate Message Code Path

| Step | File | Responsibility |
|---|---|---|
| UI action | `frontend/src/app/campaigns/[id]/page.tsx` | User clicks generate for a contact. |
| Frontend service | `frontend/src/services/api.ts` | Calls the backend endpoint and maps response state. |
| Controller | `backend/src/modules/campaigns/campaigns.controller.ts` | Exposes `POST /campaigns/:id/contacts/:contactId/generate`. |
| Service | `backend/src/modules/campaigns/campaigns.service.ts` | Verifies user ownership, claims pending state, calls LLM, persists result. |
| Schema | `backend/src/modules/campaigns/schemas/campaign.schema.ts` | Stores attached contact generation status/message/error. |
| LLM wrapper | `backend/src/shared/llm/llm.service.ts` | Provider-agnostic `complete(prompt)` call. |

## Contact Creation Code Path

| Step | File | Responsibility |
|---|---|---|
| User submits form | `frontend/src/app/contacts/page.tsx` | Validates required fields and calls `createContact`. |
| Contacts hook | `frontend/src/hooks/useContacts.ts` | Owns `creating`, `createError`, reload, and create state. |
| Frontend service | `frontend/src/services/contacts.ts` | Calls `POST /contacts` through the shared request wrapper. |
| Controller | `backend/src/modules/contacts/contacts.controller.ts` | Exposes `POST /contacts` under `UserGuard`. |
| DTO | `backend/src/modules/contacts/dtos/create-contact.dto.ts` | Runtime-validates name/email/company/title/do-not-contact. |
| Service | `backend/src/modules/contacts/contacts.service.ts` | Creates the user-scoped contact and handles duplicate email. |
| Schema | `backend/src/modules/contacts/schemas/contact.schema.ts` | Stores contact fields and user-scoped indexes. |

Frontend form submit:

```tsx
// frontend/src/app/contacts/page.tsx (abbreviated excerpt)
const handleCreateContact = async (e: React.FormEvent) => {
  e.preventDefault();
  setFormError(null);
  setCreateSuccess(false);

  if (!name.trim() || !email.trim()) {
    setFormError('Name and Email are required.');
    return;
  }

  const created = await createContact({
    name: name.trim(),
    email: email.trim(),
    company: company.trim() || undefined,
    title: title.trim() || undefined,
    doNotContact: suppressed,
  });

  if (created) {
    setName('');
    setEmail('');
    setCompany('');
    setTitle('');
    setSuppressed(false);
    setCreateSuccess(true);
  }
};
```

The hook owns create state and refreshes the list after a successful create:

```ts
// frontend/src/hooks/useContacts.ts (abbreviated excerpt)
const createContact = useCallback(
  async (body: CreateContactBody) => {
    setCreating(true);
    setCreateError(null);
    try {
      await contactsApi.create(body);
      await load();
      return true;
    } catch (e) {
      setCreateError(
        e instanceof ApiError ? e.message : 'Failed to create contact',
      );
      return false;
    } finally {
      setCreating(false);
    }
  },
  [load],
);
```

The contact service is the only frontend layer that knows the route:

```ts
// frontend/src/services/contacts.ts
create(body: CreateContactBody): Promise<Contact> {
  return request<Contact>('/contacts', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
```

Backend route and validation:

```ts
// backend/src/modules/contacts/contacts.controller.ts
@Post()
create(@CurrentUser() userId: string, @Body() dto: CreateContactDto) {
  return this.contactsService.create(userId, dto);
}
```

```ts
// backend/src/modules/contacts/dtos/create-contact.dto.ts
export class CreateContactDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsBoolean()
  doNotContact?: boolean;
}
```

Backend service stores the current `userId` with the contact and converts
duplicate email index errors into a 400:

```ts
// backend/src/modules/contacts/contacts.service.ts
async create(userId: string, dto: CreateContactDto): Promise<Contact> {
  try {
    return await this.contactModel.create({ ...dto, userId });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new BadRequestException(
        'A contact with this email already exists.',
      );
    }
    throw error;
  }
}
```

## Frontend Snippets

Campaign detail calls the service and shows local generating state while the
request is running:

```tsx
// frontend/src/app/campaigns/[id]/page.tsx (abbreviated excerpt)
const handleGenerate = async (contactId: string) => {
  if (!campaign) return;
  setGeneratingContactId(contactId);
  setLaunchError(null);
  try {
    await campaignsService.generateForContact(campaign.id, contactId);
    const outboxData = await campaignsService.getOutbox(campaign.id);
    setOutbox(outboxData.outbox);
    setGenerations(outboxData.generations);

    const camp = await campaignsService.getById(campaign.id);
    setCampaign(camp);
  } catch (err: any) {
    setLaunchError(err.message || 'Email template preparation failed.');
  } finally {
    setGeneratingContactId(null);
  }
};
```

The frontend service keeps the component away from raw `fetch` and calls the
required generate endpoint:

```ts
// frontend/src/services/api.ts (abbreviated excerpt)
const result = await request<{
  status: string;
  message?: string;
  error?: string;
}>(`/campaigns/${campaignId}/contacts/${contactId}/generate`, {
  method: 'POST',
});

return {
  success: result.status === 'finished',
  usedRealAPI: true,
  generation: {
    status: result.status === 'finished' ? 'completed' : 'failed',
    message: result.message || '',
    error: result.error || null,
  },
};
```

Contacts use a service plus hook pattern so loading, errors, refetch, and create
state live outside the page component:

```ts
// frontend/src/hooks/useContacts.ts (abbreviated excerpt)
const load = useCallback(async (options: { cancelPrevious?: boolean } = {}) => {
  if (options.cancelPrevious) {
    abortRef.current?.abort();
  }
  const controller = new AbortController();
  abortRef.current = controller;
  // Full implementation also uses a request sequence ref to ignore stale responses.

  setLoading(true);
  setError(null);
  try {
    const res = await contactsApi.list(params, { signal: controller.signal });
    setData({
      items: res.items,
      total: res.total,
      page: res.page,
      limit: res.limit,
    });
  } catch (e) {
    setError(e instanceof ApiError ? e.message : 'Failed to load contacts');
  } finally {
    setLoading(false);
  }
}, [params]);
```

## Backend Snippets

The controller is intentionally thin. It extracts route params/current user and
delegates business logic to the service:

```ts
// backend/src/modules/campaigns/campaigns.controller.ts (abbreviated excerpt)
@Post(':id/contacts/:contactId/generate')
generate(
  @CurrentUser() userId: string,
  @Param('id') id: string,
  @Param('contactId') contactId: string,
) {
  return this.campaignsService.generateForContact(userId, id, contactId);
}
```

The campaign schema embeds the per-contact generation state required by the
take-home:

```ts
// backend/src/modules/campaigns/schemas/campaign.schema.ts (abbreviated excerpt)
export enum GenerationStatus {
  NOT_GENERATED = 'not_generated',
  PENDING = 'pending',
  FINISHED = 'finished',
  FAILED = 'failed',
}

@Schema({ _id: false })
export class CampaignContact {
  @Prop({ type: Types.ObjectId, ref: 'Contact', required: true })
  contactId: Types.ObjectId;

  @Prop({ type: String, enum: GenerationStatus, default: GenerationStatus.NOT_GENERATED })
  status: GenerationStatus;

  @Prop()
  generatedMessage?: string;

  @Prop()
  error?: string;
}
```

The service verifies the campaign/contact belong to the current user before
generating:

```ts
// backend/src/modules/campaigns/campaigns.service.ts (abbreviated excerpt)
const campaign = await this.requireCampaign(userId, campaignId);
const [contact] = await this.contactsService.findOwnedByIds(userId, [
  contactId,
]);
if (!contact) {
  throw new NotFoundException('Contact not found');
}
```

The service atomically claims the contact as `pending` so repeated requests do
not blindly run duplicate LLM work:

```ts
// backend/src/modules/campaigns/campaigns.service.ts (abbreviated excerpt)
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
```

The LLM call happens server-side, after the prompt template is hydrated with the
attached contact:

```ts
// backend/src/modules/campaigns/campaigns.service.ts (abbreviated excerpt)
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
```

On success, the generated message is persisted:

```ts
// backend/src/modules/campaigns/campaigns.service.ts (abbreviated excerpt)
await this.campaignModel.findOneAndUpdate(
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
```

On failure, the error is persisted on the same campaign contact instead of
leaving the request as an unhandled 500:

```ts
// backend/src/modules/campaigns/campaigns.service.ts (abbreviated excerpt)
const message = safeErrorMessage(error, 'Message generation failed');
await this.campaignModel.updateOne(
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
```

## Contacts Pagination Snippet

Contacts are always scoped to `userId`, and supported sorts append `_id` as a
tie-breaker so pagination has a total deterministic order:

```ts
// backend/src/modules/contacts/contacts.service.ts (abbreviated excerpt)
const filter: FilterQuery<ContactDocument> = { userId };

const sortField = query.sort || 'createdAt';
const direction =
  query.direction === 'asc' || query.direction === 'desc'
    ? query.direction
    : sortField === 'createdAt'
      ? 'desc'
      : 'asc';
const sortOrder = direction === 'asc' ? 1 : -1;
const sort: Record<string, 1 | -1> = {
  [sortField]: sortOrder,
  _id: 1,
};

const [items, total] = await Promise.all([
  this.contactModel
    .find(filter)
    .sort(sort)
    .skip((page - 1) * limit)
    .limit(limit)
    .lean()
    .exec(),
  this.contactModel.countDocuments(filter).exec(),
]);
```

The contact indexes support user-scoped sorting and per-user email uniqueness:

```ts
// backend/src/modules/contacts/schemas/contact.schema.ts
ContactSchema.index({ userId: 1, createdAt: -1, _id: 1 });
ContactSchema.index({ userId: 1, name: 1, _id: 1 });
ContactSchema.index({ userId: 1, email: 1 }, { unique: true });
```

## LLM Wrapper Snippet

The app calls one provider-agnostic service contract. Provider/model selection
comes from `.env`, so the campaigns service does not care whether the key is for
OpenAI, Anthropic, or Gemini:

```ts
// backend/src/shared/llm/llm.service.ts (abbreviated excerpt)
constructor() {
  this.provider = (process.env.LLM_PROVIDER || 'anthropic').toLowerCase();
  this.model = process.env.LLM_MODEL || this.defaultModel();
  this.maxTokens = Number(process.env.LLM_MAX_TOKENS || 900);
}

async complete(prompt: string): Promise<string> {
  return this.retryTransient(async () => {
    switch (this.provider) {
      case 'openai':
        return this.completeOpenai(prompt);
      case 'gemini':
        return this.completeGemini(prompt);
      case 'anthropic':
        return this.completeAnthropic(prompt);
      default:
        throw new Error(`Unknown LLM_PROVIDER: ${this.provider}`);
    }
  });
}
```

## Regeneration Flow

There are two separate ideas to keep clear in the interview:

| Type | Status in this repo | Meaning |
|---|---|---|
| Sequence-step regeneration | Implemented as a product extension | Regenerate one campaign sequence email template, review it, then replace or insert it. |
| Per-contact message regeneration with history | Official stretch-goal shape | Regenerate one contact's generated message with a tweaked prompt and keep previous attempts. |

The current implemented regeneration flow is for campaign sequence steps. The UI
does not immediately mutate the campaign when the LLM returns. It first shows a
proposal, then the user can `Replace`, `Insert Below`, or `Discard`.

### Current Sequence-Step Regeneration Path

| Step | File | Responsibility |
|---|---|---|
| User clicks `Regenerate` | `frontend/src/app/campaigns/[id]/page.tsx` | Opens instructions textarea for a sequence step. |
| User clicks `Generate Draft` | `frontend/src/app/campaigns/[id]/page.tsx` | Calls service and stores returned proposal locally. |
| Frontend service | `frontend/src/services/api.ts` | Calls `POST /campaigns/:id/sequence-steps/:stepId/regenerate`. |
| Backend controller | `backend/src/modules/campaigns/campaigns.controller.ts` | Delegates to `CampaignsService.regenerateSequenceStep`. |
| Backend service | `backend/src/modules/campaigns/campaigns.service.ts` | Builds a safe LLM prompt and parses strict JSON. |
| Apply proposal | `frontend/src/app/campaigns/[id]/page.tsx` | Calls update step endpoint to replace or append generated copy. |

Frontend service call:

```ts
// frontend/src/services/api.ts (abbreviated excerpt)
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
}
```

Frontend proposal flow:

```tsx
// frontend/src/app/campaigns/[id]/page.tsx (abbreviated excerpt)
const handleGenerateStepProposal = async (step: Campaign['sequenceSteps'][number]) => {
  if (!campaign) return;
  const key = stepKey(step);
  setRegeneratingStepId(key);
  setLaunchError(null);
  try {
    const proposedStep = await campaignsService.regenerateSequenceStep(
      campaign.id,
      key,
      regenerateInstructions,
    );
    setRegenerationProposal({ stepId: key, step: proposedStep });
    setGenerationNotice(`Step ${step.order} regeneration is ready for review.`);
  } catch (err: any) {
    setLaunchError(err.message || 'Failed to regenerate sequence step.');
  } finally {
    setRegeneratingStepId(null);
  }
};
```

Applying the proposal is a separate mutation:

```tsx
// frontend/src/app/campaigns/[id]/page.tsx (abbreviated excerpt)
const nextStep =
  mode === 'insert'
    ? {
        delayMinutes: step.delayMinutes,
        subjectTemplate: step.subjectTemplate,
        promptTemplate: appendTemplateBody(
          step.promptTemplate,
          proposed.promptTemplate,
        ),
      }
    : {
        delayMinutes: proposed.delayMinutes,
        subjectTemplate: proposed.subjectTemplate,
        promptTemplate: proposed.promptTemplate,
      };

const updated = await campaignsService.updateSequenceStep(
  campaign.id,
  key,
  nextStep,
);
setCampaign(updated);
```

Backend route:

```ts
// backend/src/modules/campaigns/campaigns.controller.ts (abbreviated excerpt)
@Post(':id/sequence-steps/:stepId/regenerate')
regenerateSequenceStep(
  @CurrentUser() userId: string,
  @Param('id') id: string,
  @Param('stepId') stepId: string,
  @Body() dto: RegenerateSequenceStepDto,
) {
  return this.campaignsService.regenerateSequenceStep(userId, id, stepId, dto);
}
```

Backend service:

```ts
// backend/src/modules/campaigns/campaigns.service.ts (abbreviated excerpt)
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

return { step: regeneratedStep };
```

Regeneration DTO:

```ts
// backend/src/modules/campaigns/dtos/update-sequence-step.dto.ts
export class RegenerateSequenceStepDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  instructions?: string;
}
```

The LLM prompt is constrained so it returns actual email copy, not another prompt
for a later model call:

```ts
// backend/src/modules/campaigns/campaign-generation.helpers.ts (abbreviated excerpt)
return [
  'Regenerate exactly one outreach sequence email step.',
  'Return strict JSON only with this shape:',
  '{"subjectTemplate":"...","promptTemplate":"..."}',
  'Use only these placeholders when needed: {{name}}, {{first_name}}, {{last_name}}, {{email}}, {{company}}, {{title}}.',
  'Keep placeholders as placeholders. Do not include real personal data, URLs, phone numbers, or markdown fences.',
  'The promptTemplate must be actual email body copy, not instructions to write an email.',
  // ...
].filter(Boolean).join('\n');
```

The response parser rejects unsafe or wrong-shaped LLM output:

```ts
// backend/src/modules/campaigns/campaign-generation.helpers.ts (abbreviated excerpt)
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
```

### If They Ask For Official Per-Contact Regeneration

The official stretch goal is slightly different from the implemented
sequence-step regeneration. A clean implementation would extend the existing
required endpoint instead of creating a separate product flow:

1. Add optional body: `{ "promptTemplateOverride": "..." }`.
2. Add `generationHistory` to the embedded campaign contact.
3. On each attempt, append `{ attemptId, status, promptTemplate, message/error }`.
4. Keep `generatedMessage` as the latest successful result.
5. Keep the existing endpoint path:
   `POST /campaigns/:id/contacts/:contactId/generate`.

That answer shows the distinction: this repo already supports regenerating
sequence-step templates, while the official stretch goal would regenerate a
single contact's personalized message and preserve prior attempts.

## Key Decisions To Explain

| Decision | Short explanation |
|---|---|
| Persist status instead of only returning response | The UI can recover from refreshes and show failed/pending/finished states. |
| `userId` in every query | Prevents one user from reading or generating against another user's data. |
| `_id` tie-breaker in pagination | Makes offset pagination deterministic when names or timestamps collide. |
| Service + hook on frontend | Components stay focused on UI while hooks/services own loading, error, refetch, and API mapping. |
| Catch LLM failures | Provider/network/template issues become persisted failed states instead of unhandled 500s. |
| Review-before-apply regeneration | Sequence-step regeneration returns a proposal first, so the campaign is not mutated by bad LLM output until the user accepts it. |
| Simulated outbox only | Avoids accidental real email delivery; real sending is outside the original take-home scope. |

## Likely Live Extension Targets

The official stretch goals are small changes around the required generate flow:

| Extension | Where to start |
|---|---|
| Generated / total progress indicator | Add counts in campaign serialization, then display near attached contacts. |
| Regenerate with tweaked template + small history | Extend the per-contact generate endpoint with optional prompt override plus `generationHistory` on campaign contact. |
| Optimistic UI on generate | Update the row to `pending` before the request returns, then reconcile. |
| Debounce/rate-limit generate | Disable repeated clicks in the UI and keep backend pending claims idempotent. |
