# Setup

Prerequisites: **Node 20+**, **Docker** (for MongoDB), and an **Anthropic API key**.

## 1. MongoDB

```bash
docker compose up -d        # starts MongoDB on localhost:27017
```

(No seed data — you create records through the API.)

## 2. Backend (NestJS, port 8080)

```bash
cd backend
cp .env.example .env        # set LLM_PROVIDER + paste the matching key into .env
npm install
npm run start:dev
```

- API base: http://localhost:8080
- Health check: http://localhost:8080/health

Every request must include a header identifying the current user (the lightweight auth stand-in):

```
x-user-id: demo-user
```

Use any string. Resources you create are scoped to that id. See `src/shared/auth`.

## 3. Frontend (Next.js, port 3000)

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

- App: http://localhost:3000

The frontend already sends `x-user-id: demo-user` for you (see `src/services/api.ts`).

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
- **401 from API** → you're missing the `x-user-id` header.
- **LLM 401 / auth error** → check `LLM_PROVIDER` matches the key you set in `backend/.env`.
