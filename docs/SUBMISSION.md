# Submission checklist

The required Bladen take-home flow is implemented first. Groups, sequences, outbox, Redis/BullMQ, and the AI wizard are extensions built on top of that core.

## Required scope

### Backend — contacts
- [x] `POST /contacts` creates a contact, validated (bad input -> 400)
- [x] `GET /contacts` is paginated (`page`, `limit`)
- [x] `GET /contacts` supports `search` (name + company)
- [x] `GET /contacts` supports `sort` (name, createdAt)
- [x] Pagination is stable: every supported sort appends `_id` as a deterministic tie-breaker.
- [x] Schema has justified indexes: user-scoped created/name sort indexes plus unique user/email.
- [x] Service spec exists; core build/test commands are documented below.

### Backend — campaigns + LLM
- [x] `POST /campaigns` creates campaigns with prompt/sequence data.
- [x] `POST /campaigns/:id/contacts` attaches contacts.
- [x] `POST /campaigns/:id/contacts/:contactId/generate` interpolates the attached contact into `promptTemplate`, calls the LLM, and returns the result.
- [x] Generation persists `pending -> finished/failed` on the campaign contact.
- [x] Provider error / timeout / bad template are caught and persisted as failed generation state.

### Auth
- [x] Contacts, groups, campaigns, recipients, and outbox rows are scoped to the current user.

### Frontend
- [x] Contacts page: paginated, searchable table
- [x] Contacts page: create form, including suppression flag
- [x] Data access via services + hooks
- [x] Campaigns page: required core form for name + promptTemplate + attached contacts
- [x] Campaign detail page: attached contacts, per-contact generation, plus extension launch/sequence/outbox views
- [x] Generate button per contact with loading/result/error states

## Product extension

- [x] Contact groups with many-to-many membership
- [x] Campaign targets multiple groups plus direct contacts
- [x] Launch snapshots unique recipients and skips suppressed contacts
- [x] Simulated outbox instead of real email delivery
- [x] BullMQ + Redis worker for delayed sequence jobs
- [x] Duplicate guards via campaign launch state, deterministic BullMQ job IDs, and unique outbox index
- [x] N-step sequences with per-step delay
- [x] Seeded `CampaignTemplate` / `PromptTemplate` records for read-only template management, with 4-step base skeletons
- [x] `GET /campaign-templates` for wizard template selection
- [x] `POST /campaigns/generate-draft` immediately creates a `generating` campaign and enqueues draft generation
- [x] Campaign-generation worker converts valid LLM JSON into a reviewed `draft`, or persists `failed` + `generationError`
- [x] AI-generated draft sequences are capped at 4 steps and convert delay days to stored delay minutes
- [x] Generated sequence steps are actual email subject/body templates with placeholders, not second-pass LLM prompts
- [x] Extension sequence/outbox flow hydrates generated templates from recipient snapshots instead of sending real email

## How to run

- LLM provider used locally: `openai`
- Start MongoDB and Redis: `docker compose up -d mongo redis`
- Backend: `cd backend && npm install && npm run seed && npm run start:dev`
- Frontend: `cd frontend && npm install && npm run dev -- -p 3001`

Seeded login:

| Email | Password | Role |
|---|---|---|
| `admin@fuzzy.local` | `password123` | admin |
| `ava@fuzzy.local` | `password123` | user |
| `ben@fuzzy.local` | `password123` | user |
| `clara@fuzzy.local` | `password123` | user |

## Scope cuts & notes

- Real email sending is intentionally not implemented. This avoids accidental delivery and keeps the assessment locally testable.
- Reply tracking, unsubscribe handling, bounce processing, provider webhooks, and deliverability controls are future production work.
- Groups, sequences, outbox, Redis/BullMQ, and the wizard are beyond the original brief; the required core remains available and visible from `/campaigns`.
- Campaign generation is intentionally asynchronous so the UI can show `generating` immediately and poll the campaign detail page until it becomes `draft` or `failed`.
