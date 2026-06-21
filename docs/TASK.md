# Task: Mini Outreach Sequencer

You're building a 1%-scale slice of an outreach automation tool. A user manages contacts,
groups them into a campaign, and generates an AI-personalized opening message per contact.

Work through the **required scope** first. Stretch goals are optional and only matter once the
core is solid. **A correct, well-structured core beats a broad, shaky one.**

---

## Required scope (the core ~4 hours)

### 1. Contacts module (backend)

- **`POST /contacts`** — create a contact. Validate the body with a DTO. Fields:
  `name` (required), `email` (required, valid email), `company`, `title`.
  Invalid input must return **400**, not 500.
- **`GET /contacts`** — return a **paginated** list. Support:
  - `page` / `limit`
  - `search` — matches against `name` and `company`
  - `sort` — at least by `name` and `createdAt`
  - ⚠️ Pagination must be **deterministic**: for a fixed dataset, the same contact must never
    appear on two pages and none must be skipped. This breaks easily if you sort on a
    non-unique field (e.g. lots of contacts created in the same millisecond, or paging by
    `name`) — think about what makes the ordering total. Note in PLAN.md how you guarantee it.
- A Mongoose **schema** with appropriate types and at least one **index** you can justify.
- At least one co-located **`.spec.ts`** unit test for the service (e.g. the list/pagination logic).

### 2. Campaigns module + the LLM generation (backend)

- **`POST /campaigns`** — create a campaign. Fields: `name`, `promptTemplate`.
  - The template uses `{{placeholders}}`, e.g.
    `"Write a 2-sentence LinkedIn opener for {{name}}, a {{title}} at {{company}}."`
- **`POST /campaigns/:id/contacts`** — attach one or more existing contacts to a campaign.
- **`GET /campaigns/:id`** — return the campaign and its attached contacts. Include enough
  contact detail (at least name) for the frontend to render the list and each contact's
  generation status/message — how you shape that (populate vs. a second fetch) is your call.
- **`POST /campaigns/:id/contacts/:contactId/generate`** — the centerpiece:
  1. Interpolate the contact's data into the campaign's `promptTemplate`.
  2. Call the LLM (use the provided `LlmService`).
  3. **Persist** the generated message and a **status** (`pending` → `finished` / `failed`).
  4. Return the result.
  - Handle the unhappy paths: provider error, timeout, malformed template. A failure here
    must not 500 the whole request with an unhandled exception — record `failed` and surface
    a sensible error.

### 3. Auth boundary

- A request is identified by the `x-user-id` header (already enforced by the provided guard).
- **Contacts and campaigns must be scoped to the user** — user A cannot read or generate
  against user B's data.

### 4. Frontend

- **Contacts page** (`/contacts`):
  - Paginated, searchable table of contacts.
  - A form to create a contact.
  - Use the **service layer** (`src/services`) and a **custom hook** that owns loading/error
    state — follow the existing example pattern. No raw `fetch` inside components.
- **Campaign detail page** (`/campaigns/[id]`):
  - Show contacts attached to the campaign.
  - A **"Generate message"** button per contact that calls the generate endpoint and shows:
    idle → generating → result, and a clear **error state** if it fails.

---

## Explicitly OUT of scope

Do not spend time on: real email/LinkedIn sending, payments/Stripe, OAuth/login UI,
deployment/CI, or pixel-perfect visual design. Plain, clean UI is fine.

---

## Stretch goals (optional — only if core is solid)

- **Regenerate** with a tweaked template and keep a small history.
- A "generated / total" progress indicator on the campaign.
- Optimistic UI on generate, reconciled on response.
- Rate-limit or debounce the generate button.

> ℹ️ There is a known, deliberate extension we may ask you to build **live** in a follow-up
> session. Building the core cleanly — especially the schema, the generate flow, and the
> status field — is the best preparation. We want to see you navigate *your own* code.

---

## Before you write code

Fill in **[PLAN.md](./PLAN.md)**. It's quick (½–1 page) and it's graded. It's where you show
how you scope: your data model, your API surface, how you handle LLM failure, **what you cut
and why**, and how you used AI tooling.
