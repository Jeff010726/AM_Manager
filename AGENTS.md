# AM Manager Agent Guide

This file defines project-level instructions for coding agents working in this repository.

## Scope

- Root workspace: `am-manager` (npm workspaces)
- Frontend: `apps/web` (Vite + React + TypeScript)
- Backend: `apps/worker` (Cloudflare Workers + Hono + D1)
- Docs: `docs/`

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Run D1 migrations (local):
```bash
npm run d1:migrate --workspace @am-manager/worker
```

3. Start backend:
```bash
npm run dev:worker
```

4. Start frontend:
```bash
npm run dev:web
```

## Build / Deploy

- Build web: `npm run build:web`
- Build worker: `npm run build:worker`
- Build all: `npm run build`
- Deploy worker: `npm run deploy:worker`
- Web deploy: GitHub Actions workflow `.github/workflows/deploy-pages.yml`

## Required Env / Config

- Worker secrets and vars:
  - `apps/worker/.dev.vars`
  - `apps/worker/wrangler.toml`
- Web env example:
  - `apps/web/.env.example`

## Change Rules

- Keep business rules consistent with `docs/DEVELOPMENT.md`.
- If API contracts change, update both:
  - `apps/worker/src/index.ts`
  - `apps/web/src/api.ts` and `apps/web/src/types.ts`
- After non-trivial changes, run at least:
```bash
npm run build:web
npm run build:worker
```
- Keep responses and docs concise; prefer practical implementation details.

## Notes

- Current default accounts are documented in `README.md` and `docs/USER_GUIDE.md`.
- Repository is expected to remain deployable to:
  - Cloudflare Workers (API)
  - GitHub Pages (web)
