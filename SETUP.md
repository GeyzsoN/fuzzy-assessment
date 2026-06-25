# Setup

Prerequisites: **Node 20+**, **Docker** (for MongoDB + Redis), and an **LLM API key** for one of
Anthropic, OpenAI, or Google Gemini (your choice — see step 2).

## 1. MongoDB + Redis

```bash
docker compose up -d mongo redis
```

- MongoDB: `localhost:27017`
- Redis: `localhost:6379` for BullMQ sequence jobs

## 2. Backend (NestJS, port 8080)

```bash
cd backend
cp .env.example .env        # set LLM_PROVIDER + paste the matching key into .env
npm install
npm run seed                 # creates demo users, contacts, and campaigns
npm run start:dev
```

- API base: http://localhost:8080
- Health check: http://localhost:8080/health

Every request to the protected endpoints must include either a bearer token from `/auth/login`
or the legacy `x-user-id` header. `/health` and `/llm/smoke` are open so you can verify setup
without it.

```
x-user-id: demo-user
```

Use any string. Resources you create are scoped to that id. See `src/shared/auth`.

This repo also includes a local demo login flow backed by MongoDB. Seeded accounts:

| Email | Password | Role |
|---|---|---|
| `admin@fuzzy.local` | `password123` | admin |
| `ava@fuzzy.local` | `password123` | user |
| `ben@fuzzy.local` | `password123` | user |
| `clara@fuzzy.local` | `password123` | user |

Admin users can switch into any seeded user from the app header.

## 3. Frontend (Next.js, port 3001 locally)

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev -- -p 3001
```

- App: http://localhost:3001

The frontend sends the bearer token after login (see `src/services/api.ts`).

## 4. Verify the LLM wiring

Once the backend is up, there's a smoke-test endpoint:

```bash
curl -X POST http://localhost:8080/llm/smoke -H "Content-Type: application/json" \
  -H "x-user-id: demo-user" -d '{"prompt":"Say hello in 5 words."}'
```

If you get a completion back, your key works. (You can delete this endpoint when done.)

## Tests

```bash
cd backend && npm test
cd frontend && npm test
```

## Troubleshooting

- **Mongo connection refused** → is Docker running? `docker ps` should show the mongo container.
- **Queue jobs not processing** → confirm Redis is running: `docker compose up -d redis`.
- **401 from API** → you're missing the `x-user-id` header.
- **LLM 401 / auth error** → check `LLM_PROVIDER` matches the key you set in `backend/.env`.
