# PLAN.md

I implemented the required take-home core first, then left the broader groups/sequences/outbox/wizard work clearly framed as a product extension.

## 1. Data model

- `Contact`: user-scoped contact record with `name`, `email`, optional `company/title`, and `doNotContact`. Indexes cover user-scoped pagination/search sort (`userId + createdAt + _id`, `userId + name + _id`) and unique email per user.
- `Campaign`: user-scoped generating/draft/running/completed/failed campaign. The required core uses `name`, `promptTemplate`, and embedded attached contact generation state. Extension fields support `targetGroupIds`, `directContactIds`, and ordered `sequenceSteps`.
- `ContactGroup` + `ContactGroupMembership`: normalized many-to-many groups. Unique index on `{ userId, groupId, contactId }` prevents duplicate membership.
- `CampaignRecipient`: launch-time recipient snapshot after resolving selected groups/direct contacts and deduping by `contactId`.
- `OutboxMessage`: simulated send ledger. Unique index on `{ campaignId, stepId, contactId }` is the hard duplicate-send guard.
- `CampaignTemplate` + `PromptTemplate`: read-only seeded templates that drive the AI campaign wizard. They provide base sequence skeletons and managed LLM instructions without putting the template logic in the UI.

## 2. API surface

- Required core: `POST /contacts`, `GET /contacts`, `POST /campaigns`, `POST /campaigns/:id/contacts`, `GET /campaigns/:id`, `POST /campaigns/:id/contacts/:contactId/generate`.
- Product extension: `GET /groups`, `POST /groups`, `GET /groups/:id`, `POST /groups/:id/contacts`, `DELETE /groups/:id/contacts/:contactId`, `GET /campaigns`, `PATCH /campaigns/:id`, `POST /campaigns/:id/launch`, `GET /campaigns/:id/outbox`, `GET /campaign-templates`, `POST /campaigns/generate-draft`.
- DTOs use `class-validator`; bad IDs/input should return 400. Campaign edits are restricted to draft campaigns.

## 3. LLM generation and queue failure handling

- Required generate flow sets per-contact status `pending`, interpolates the attached contact into the campaign `promptTemplate`, calls `LlmService`, then persists `finished` + message or `failed` + error. Provider errors, timeouts, malformed templates, and empty outputs are caught and recorded instead of surfacing as unhandled 500s.
- AI campaign draft generation is asynchronous. `POST /campaigns/generate-draft` creates a `generating` campaign immediately, enqueues `campaign-generation`, then the worker asks the LLM for strict JSON sequence steps. It caps generated sequences at four steps, uses day-based delays in the wizard, stores delays as minutes, and marks the campaign `draft` or `failed` with `generationError`.
- Sequence launch uses BullMQ + Redis (`sequence-email`) with deterministic BullMQ-safe job IDs derived from `campaignId`, `stepId`, and `contactId`. The persisted outbox dedupe key remains `campaignId:stepId:contactId`.
- Extension sequence worker atomically claims queued/failed outbox rows, hydrates the generated subject/body templates with recipient snapshots, marks the simulated email `sent`, then schedules the next sequence step. Retries cannot create duplicate outbox rows because the DB unique index is authoritative.

## 4. Auth / scoping

- All contact, group, campaign, recipient, and outbox queries include `userId`.
- The auth guard accepts the seeded bearer-token login flow and keeps legacy `x-user-id` compatibility.
- Cross-user IDs are rejected by ownership lookups before attach, group membership, launch, or generation.

## 5. Scope decisions

- I kept real email delivery out of scope and implemented a simulated outbox only as an extension so testing cannot accidentally email people.
- I chose BullMQ + Redis over Celery/RabbitMQ for the extension because this is a NestJS background-job and delayed-sequence problem, not a Python worker or cross-service messaging problem.
- I did not implement unsubscribe, reply tracking, bounce handling, deliverability, or provider webhooks. Those are beyond the required core and required before real production sending.

## 6. AI tooling

- Used AI assistance to reason through schema/API design, implementation, and verification.
- I validated generated code with local builds/tests and real API smoke checks, and changed the LLM client when OpenAI returned a transport-level premature close.
