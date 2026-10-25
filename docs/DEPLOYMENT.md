# Deployment

## Live

| What | Value |
|---|---|
| Production URL (public, no login) | https://shipmentos-preflight.vercel.app |
| GitHub (public) | https://github.com/saisiddharthnandhakumar/shipmentos-preflight |
| Vercel project | `shipmentos-preflight` (`prj_B1gEXZfUCcU4rviXlUjFlv3QNPXP`), team `saisiddharthnandhakumar-7019s-projects` |
| Vercel functions | Node.js 24, Fluid compute, region `iad1` (next to Neon us-east-1) |
| Neon project | `shipmentos` (`curly-feather-54563708`), AWS us-east-1, Postgres 17 |
| Neon production branch | `production` (`br-soft-pine-b7z2pzad`, default) — used only by Vercel Production |
| Neon dev/test branch | `dev` (`br-lively-dream-b70ou81q`) — local dev, all automated tests, Vercel Preview |

## How it was provisioned

1. **GitHub** — `gh repo create shipmentos-preflight --public --source=. --push` (no GitHub MCP connector was
   available in the session; `gh` was authenticated with `repo` scope). Every phase was pushed as its own commit.
2. **Neon** (Neon MCP connector) — `create_project` (`shipmentos`, branch `production`, database `shipmentos`),
   `create_branch` (`dev`), `get_connection_string` for each branch. Pooled URLs (`-pooler` host) are used by
   the app; direct URLs only for migrations.
3. **Migrations and reference seed** (run from a developer machine, never at runtime):

   ```bash
   ENV_FILE=.env.production.local npm run db:migrate
   ```

   ```bash
   ENV_FILE=.env.production.local npm run db:seed
   ```

   ```bash
   ENV_FILE=.env.production.local npm run db:verify
   ```

   Result on production: 1 migration applied; `carrier_options=9 rule_definitions=10 parity=OK`
   (seed run twice to prove idempotency). The same was done on `dev` with `.env.local`.
4. **Vercel** (Vercel MCP connector) — `create_git_project` linked to the GitHub repo (continuous deployment
   from `main`), `create_project_env` for encrypted variables, `update_project` to keep Vercel
   Authentication on **preview deployments only** (production must be public) and pin functions to `iad1`.
   The CLI (`vercel link`, `vercel deploy`) was used for ad-hoc deployments.

## Environment variables (Vercel)

| Key | Production | Preview | Type |
|---|---|---|---|
| `DATABASE_URL` | Neon `production` branch, pooled | Neon `dev` branch, pooled | sensitive |
| `GEMINI_API_KEY` | ✔ | ✔ | sensitive |
| `GEMINI_MODEL` | `gemini-3.5-flash` | same | plain |
| `SESSION_TTL_DAYS` | `7` | `7` | plain |

`DATABASE_URL_UNPOOLED` is intentionally **not** set on Vercel: migrations run only from a developer
machine. `SHIPMENTOS_FAKE_AI` is never set on Vercel and is ignored there anyway (`process.env.VERCEL`).

## Release checklist

```bash
npm run lint && npm run typecheck && npm run test && npm run build && npm run test:e2e
```

```bash
ENV_FILE=.env.production.local npm run db:migrate
```

```bash
git push origin main
```

```bash
SMOKE_URL=https://shipmentos-preflight.vercel.app npx tsx scripts/smoke.ts
```

The smoke script uses its own fresh anonymous sessions with synthetic data and deletes them at the end
(`DELETE /api/session`). It checks: public access, health/reference parity, no secrets in client bundles,
`__Host-` HttpOnly Secure cookie, Gemini extraction, completion, "+1 pallet" → £720, idempotent replay,
409 on stale revision, two chats in history, transcript order, both uploads, All bookings totals, no-eligible
carrier case, cross-session 404s, unauthenticated 401, delete without touching imports.

## Protection notes

- Production (`shipmentos-preflight.vercel.app`) is public by design: the app has no login.
- Preview deployments keep Vercel Authentication and use the `dev` database branch.
- Deployment order note: linking the repository made Vercel deploy `main` to production immediately, so
  the very first production deployment was not preceded by a preview. Later changes are verified locally
  (full suite + E2E) and on a preview before relying on the production smoke test.
