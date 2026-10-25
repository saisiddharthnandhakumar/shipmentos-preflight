# ShipmentOS — conversational shipment booking & pre-flight error checker

> **This is a booking-preparation and pre-flight checking demo.** It does not book carriers, schedule
> pickups, contact anyone, or give customs / dangerous-goods compliance guarantees. A "ready to submit"
> booking is a prepared draft that the seller submits to a carrier themselves.

UK sellers shipping pallets to **Germany, France or the Netherlands** (GBP) can:

1. **Chat to book** — describe a shipment in plain English. ShipmentOS extracts what you said, asks only
   for what's missing, and re-checks everything when you change a detail ("actually add one more pallet").
2. **Upload Excel** — drop a workbook with `Bookings` and `Items` sheets (the case template) and get every
   booking checked against the ten-rule rulebook, with the exact reason and fix for each failure.

Both modes share one deterministic engine: **R-01 … R-10** with Red/Amber severity, carrier eligibility by
route and kg/pallet, priority ranking (Cheapest / Fastest / Most reliable / Balanced), status, dates and next
steps. Gemini is used only to turn a chat message into typed patch operations — never for arithmetic, rule
verdicts, carrier choice or dates.

- **Live app (no login):** https://shipmentos-preflight.vercel.app
- **Repository:** https://github.com/saisiddharthnandhakumar/shipmentos-preflight

## Features

- Previous-chats sidebar (Neon-backed): new chat, reopen full transcript with "Load earlier messages",
  continue an old booking, refresh-safe `/chat/[bookingId]`, delete with confirmation, mobile drawer.
- Live booking panel: status, pre-flight strip (R-01…R-10), still-needed list, facts, items, carrier card
  with kg/pallet gauge and alternatives, change log, honest ready-to-submit confirmation, Edit booking form.
- Excel results: summary counts that filter, search, phone-friendly list, detail drawer with every rule,
  actual vs expected, fix, carrier and next steps; input issues listed separately from rules.
- All bookings: chat and Excel bookings together, filter by source/status, search (filters live in the URL).
- Anonymous, isolated sessions: no login; 256-bit HttpOnly cookie; only its SHA-256 hash is stored.

## Stack

Next.js 16.4 (App Router, Node runtime) · React 19.3 · TypeScript 5.9 (strict) · Tailwind CSS 4.3 ·
Zod 4.6 · ExcelJS 4.4 · `@google/genai` 2.31 (default model `gemini-3.5-flash`) · Drizzle ORM 0.45 +
Drizzle Kit 0.31 · `pg` 8.23 + `@vercel/functions` `attachDatabasePool` · Neon PostgreSQL 17 ·
Vitest 5 · Playwright 1.64. UI components are hand-built on native `<dialog>` (accessible modal/drawer)
following `DESIGN.md`.

## Quickstart (local)

```bash
npm install
```

```bash
cp .env.example .env.local   # then fill in DATABASE_URL, DATABASE_URL_UNPOOLED, GEMINI_API_KEY
```

```bash
npm run db:migrate && npm run db:seed && npm run db:verify
```

```bash
npm run dev
```

Open http://localhost:3000. Without `GEMINI_API_KEY`, chat returns a clear "AI unavailable" message and the
Edit booking form still works; Excel upload never needs AI.

### Environment variables (server-only; never `NEXT_PUBLIC_`)

| Name | Used for |
|---|---|
| `DATABASE_URL` | Neon **pooled** connection string (app runtime) |
| `DATABASE_URL_UNPOOLED` | Neon **direct** connection string (migrations and seeds only) |
| `GEMINI_API_KEY` | Gemini API key (chat extraction only) |
| `GEMINI_MODEL` | Optional; default `gemini-3.5-flash` (verified 2026-10-25; `gemini-2.5-flash` is closed to new API users) |
| `GEMINI_THINKING` | Optional; `low` (default), `minimal` or `medium` model thinking for extraction |
| `SESSION_TTL_DAYS` | Optional; anonymous session lifetime, default 7 |
| `SHIPMENTOS_FAKE_AI` | Tests only: `1` swaps Gemini for a deterministic extractor. Ignored on Vercel. |

## Scripts

| Script | What it does |
|---|---|
| `npm run lint` / `npm run typecheck` | ESLint; route typegen + `tsc --noEmit` (strict) |
| `npm run test` | Vitest unit + integration (integration uses the Neon **dev** branch from `.env.local`) |
| `npm run test:e2e` | Playwright against `next start` (run `npm run build` first) |
| `npm run build` | Production build |
| `npm run db:generate` | Generate a new versioned migration from `lib/db/schema.ts` |
| `npm run db:migrate` | Apply committed migrations in `drizzle/` over the direct URL |
| `npm run db:seed` | Idempotently seed the 9 carrier options and 10 rule definitions, then verify parity |
| `npm run db:verify` | Print seeded reference rows and check them against the checked-in fixture |
| `npm run fixtures` | Regenerate the synthetic test workbooks in `tests/fixtures/` |
| `RUN_LIVE_AI=1 npx vitest run tests/integration/gemini-live.test.ts` | Opt-in test against the real Gemini API |
| `npx tsx --conditions=react-server scripts/eval-extractor.ts` | Prints the real model's patches for the demo phrases |

## Neon project and branches

Dedicated project **`shipmentos`** (`curly-feather-54563708`, AWS us-east-1, Postgres 17):

| Branch | Use |
|---|---|
| `production` (default) | Production app only. Migrations/seeds run explicitly with `npm run db:migrate` / `db:seed` using the production direct URL; only safe smoke tests touch it. |
| `dev` | Local development and **all** automated tests (destructive fixtures allowed). |

Migrations are never run automatically at runtime. Schema details: `docs/DB_SCHEMA.md`.

## Connectors / CLI used to deliver this

- **GitHub:** no GitHub MCP connector was available in this Claude Code session; the authenticated `gh` CLI
  (scopes `repo`, `workflow`) created the public repo and every push.
- **Neon:** the Neon MCP connector created the project and the `dev` branch and issued connection strings.
- **Vercel:** Vercel MCP connector + authenticated Vercel CLI (see `docs/DEPLOYMENT.md`).

## Privacy and retention

- No accounts. Your history lives with an anonymous cookie in **this browser only** and does not sync to
  other devices. Another browser (or incognito window) sees nothing and cannot open your booking URLs.
- Sessions expire **7 days after your last visit**. Expired sessions can no longer read anything; their rows
  are removed best-effort when new sessions are created (no cron job). "Reset my data" in the sidebar deletes
  everything immediately.
- Uploaded workbooks are parsed in memory; only normalised bookings, items, findings and row-level input
  issues are stored. The raw file is never saved.
- Reference documents (case PDF / template XLSX) and real data are not in this repo; test workbooks are synthetic.

## Documentation

`docs/PRD.md` · `docs/ASSUMPTIONS.md` (every inferred decision, with its source) · `docs/TEST_MATRIX.md` ·
`docs/DB_SCHEMA.md` · `docs/DEPLOYMENT.md` · `DESIGN.md` (design system)

## Known limitations

- R-06 is a phrase screen for lithium batteries, aerosols and flammable liquids (with negation handling and
  clarification prompts), not a regulatory dangerous-goods classifier.
- Indicative delivery = collection + transit in calendar days; real carrier schedules are not consulted.
- Rate limiting is in-memory per server instance (best-effort on serverless).
- History is per browser; there is no cross-device recovery.
- Gemini can occasionally miss a fact in a very dense message even with the focused second pass; ShipmentOS
  never guesses it — the deterministic follow-up question simply asks for it.
- Uploads are capped at 4 MB (Vercel's 4.5 MB request limit), 2,000 bookings and 10,000 item rows.
