# Resume JD Operations API v0.8

NestJS boundary for every authenticated business-data workflow. Browser Supabase usage is limited to Auth sign-in, token refresh/session restoration, and sign-out.

Production can run together with the Vite dashboard in one Vercel project. See `../../docs/DEPLOYMENT_VERCEL.md`. Docker remains available when a separate long-running API is preferred.

The v0.7.4 slice owns bulk Application creation. v0.8 adds capacity-aware bulk assignment, workload settings, assignment batches, and row outcomes. See `../../docs/api/bulk-assignment.md`, `../../docs/api/applier-workloads.md`, `../../docs/api/assignment-batches.md`, and `../../docs/api/idempotency.md`.

## Local setup

1. Copy `.env.example` to `.env` and supply the project publishable key and JWT URLs. Never use a privileged key.
2. Build contracts: `npm --prefix ../../packages/contracts run build`.
3. Install: `npm install`.
4. Develop: `npm run start:dev`. This loads `.env` when present and automatically restarts the API after backend TypeScript changes.
5. Build/start: `npm run build && npm start`.

The API fails startup when required configuration is missing or invalid. Swagger is available at `/api/docs` only when enabled outside production. Liveness is `/health`; readiness is `/ready`.

Commands: `npm test`, `npm run typecheck`, and `npm run build`. From repository root, `npm run dev:api` builds shared contracts once and starts the API watcher; `npm run test:api` and `npm run build:api` build shared contracts first.

Build the container from repository root with `docker build -f apps/api/Dockerfile .`.
