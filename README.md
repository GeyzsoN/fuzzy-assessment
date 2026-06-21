# Mini Outreach Sequencer — Take-Home Assessment

Welcome, and thanks for taking the time. This is a **full-stack** exercise that mirrors the
real shape of the system you'd be working on: a NestJS + MongoDB backend, a Next.js frontend,
and one server-side LLM call that personalizes outreach copy.

It is **AI-assisted by design.** Use Claude Code, Cursor, Copilot — whatever you normally
reach for. We care about the system you build and the decisions you make, not whether you
typed every character.

---

## ⏱️ Time

- **Target: ~4 hours.** Hard ceiling: **6 hours.**
- Submit what you have at the ceiling. **We value good scope decisions over completeness.**
  A smaller, correct, well-reasoned slice beats a broad, broken one.

## 📦 What's already wired for you

You do **not** start from a blank page. This repo gives you:

- A running **NestJS 10** backend (`/backend`) with Mongo connection, an empty `contacts`
  and `campaigns` module stub, a lightweight auth guard, and the **Anthropic SDK pre-installed
  and wired** behind an `LlmService`.
- A running **Next.js 15** frontend (`/frontend`) with a service layer + an example hook
  pattern to follow.
- Seed-free local Mongo via Docker.

See [SETUP.md](./SETUP.md) to get both running (should take < 5 minutes).

## 🎯 The task

Build a small app that lets a user:
1. Manage a list of **contacts** (create + paginated, searchable list).
2. Create a **campaign** with a prompt template.
3. Attach contacts to a campaign and **generate an AI-personalized opening message** for each
   one, from the contact's data + the template.

Full requirements: **[docs/TASK.md](./docs/TASK.md)** — read this next.

## 📝 What to submit

1. Your code (this repo, pushed to a branch or sent as a zip — instructions from your contact).
2. **[docs/PLAN.md](./docs/PLAN.md)** — fill in the template. This is graded. It tests how
   you scope and reason, including what you cut and why.
3. A **3-minute Loom / screen-recording** walking through what you built and one decision you
   made. (Optional but strongly encouraged — it speeds up the next step.)

## 🔑 LLM API key (bring your own — any provider)

You supply your own key. We're **provider-agnostic**: use whatever you already have for
**Anthropic, OpenAI, or Google Gemini**. In `backend/.env` set `LLM_PROVIDER` to one of
`anthropic | openai | gemini` and paste the matching key (see `backend/.env.example`).
All three SDKs are pre-installed and the default models are cheap/fast — no key from us required.

## ✅ How you'll be evaluated

The high-level rubric (so you know where to spend effort):

| Area | What we look for |
|------|------------------|
| Backend structure | Clean NestJS module/controller/service/DTO split |
| Data correctness | **Stable, correct pagination**; sensible schema + index |
| Validation & auth | Inputs validated (bad input → 400, not 500); resources user-scoped |
| LLM integration | Server-side, templated, **handles errors/timeouts/status** — not happy-path only |
| Frontend | Service + hook layer, real loading/error states |
| Planning | PLAN.md shows deliberate, reasoned scope |

**Out of scope** (do not build): real email/LinkedIn sending, payments, OAuth, deployment,
pixel-perfect design. Correctness and structure beat breadth.

Good luck — build it the way you'd want to maintain it.
