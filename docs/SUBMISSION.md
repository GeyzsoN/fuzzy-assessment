# Submission checklist

Tick what you completed and add notes. This helps us review fairly — especially if you made
deliberate scope cuts (which we respect). Be honest; "didn't get to X" is fine.

## Required scope

### Backend — contacts
- [ ] `POST /contacts` creates a contact, validated (bad input → 400)
- [ ] `GET /contacts` is paginated (`page`, `limit`)
- [ ] `GET /contacts` supports `search` (name + company)
- [ ] `GET /contacts` supports `sort` (name, createdAt)
- [ ] Pagination is **stable** (no dupes / skips as records are added) — note your approach:
  - _approach:_
- [ ] Schema has a justified index — _which, and why:_
- [ ] At least one meaningful service `.spec.ts`

### Backend — campaigns + LLM
- [ ] `POST /campaigns` (name + promptTemplate), validated
- [ ] `POST /campaigns/:id/contacts` attaches contacts
- [ ] `POST /campaigns/:id/contacts/:contactId/generate` interpolates + calls the LLM
- [ ] Generation persists a **status** (pending → finished / failed)
- [ ] Provider error / timeout / bad template handled (no unhandled 500) — note how:
  - _approach:_

### Auth
- [ ] Contacts + campaigns are scoped to the `x-user-id` user (A can't touch B's data)

### Frontend
- [ ] Contacts page: paginated, searchable table
- [ ] Contacts page: create form
- [ ] Data access via service + hook (no `fetch` in components)
- [ ] Campaign detail page: lists attached contacts
- [ ] Generate button per contact with idle → generating → result + error states

## Stretch (optional)
- [ ] _list anything extra you built_

## How to run
- LLM provider I used: `__________`  (anthropic / openai / gemini)
- Anything reviewers should know to run it:
  -

## Scope cuts & notes
_What you deliberately didn't do, and what you'd do next:_
-
