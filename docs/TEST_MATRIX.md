# Test matrix

Layers: **U** = Vitest unit (pure functions, injected UK clock), **I** = Vitest integration against an isolated Neon `dev` branch, **E** = Playwright browser E2E against a local production build, **L** = live smoke on the deployed Vercel URL.

| # | Scenario | Layer | File |
|---|---|---|---|
| 1 | BK-001 template fixture passes all 10 rules; Carrier A £540, 5 days, 206.67 kg/pallet | U | `tests/unit/engine.test.ts` |
| 2 | R-01 pass/fail: blank, 4 digits, numeric 691200, dotted `6912.00` | U | `tests/unit/rules.test.ts` |
| 3 | R-02 exactly 1% passes, 1% + 1p fails, zero sum, £4,000 vs £5,400 message | U | `tests/unit/rules.test.ts` |
| 4 | R-03 12 × 80 ≠ 1,080 message with both fixes; multi-item | U | `tests/unit/rules.test.ts` |
| 5 | R-04 booking cartons vs item sum | U | `tests/unit/rules.test.ts` |
| 6 | R-05 1,800 kg / 3 pallets → B; explicit too-light carrier flagged; no-fit → ceil suggestion | U | `tests/unit/carriers.test.ts` |
| 7 | R-06 synonyms (power bank, Li-ion, spray paint, flammable solvent) and negations (battery-free, non-aerosol) | U | `tests/unit/hazmat.test.ts` |
| 8 | R-07 400 kg < 540 kg; equality passes | U | `tests/unit/rules.test.ts` |
| 9 | R-08 warehouse/no appointment; business address exempt | U | `tests/unit/rules.test.ts` |
| 10 | R-09 blank country per item | U | `tests/unit/rules.test.ts` |
| 11 | R-10 yesterday fails, today passes (Europe/London around midnight/BST) | U | `tests/unit/dates.test.ts` |
| 12 | Carrier: 4 priorities × 3 countries, balanced score, tie-breaks, weight filter | U | `tests/unit/carriers.test.ts` |
| 13 | Status logic: Draft / Blocked / Needs attention / Ready | U | `tests/unit/engine.test.ts` |
| 14 | Not evaluable when inputs missing (never "pass") | U | `tests/unit/engine.test.ts` |
| 15 | XLSX parser: template example skipped, header on row 1 or 2, numeric/text HS, Excel date cells, missing columns, duplicates, orphans, many items per booking | U | `tests/unit/import.test.ts` |
| 16 | Chat patch: increment pallets 3→4, set destination Paris clears country mismatch, item update by SKU, remove item, clear field, malformed model output rejected | U | `tests/unit/patch.test.ts` |
| 17 | Missing-field question planning never re-asks known fields | U | `tests/unit/missing.test.ts` |
| 18 | UK date parsing: `5 Nov`, `05-11-2026`, `05/11`, year inference and ambiguity | U | `tests/unit/dates.test.ts` |
| 19 | Migrations + seed idempotent: exactly 9 carriers, 10 rules; parity with fixture | I | `tests/integration/reference.test.ts` |
| 20 | Session: cookie set, only hash stored, raw token never in JSON, expired session denied | I | `tests/integration/session.test.ts` |
| 21 | Cross-session isolation for chats, messages, bookings, imports, delete | I | `tests/integration/isolation.test.ts` |
| 22 | Transaction rollback leaves no partial rows | I | `tests/integration/transactions.test.ts` |
| 23 | Stale `expectedRevision` → 409; duplicate `requestId` → same response, pallets incremented once | I | `tests/integration/chat.test.ts` |
| 24 | Two chats independent; reopen transcript in order; pagination; delete/cancel | I | `tests/integration/chat.test.ts` |
| 25 | Import persisted and reopenable; all-bookings shows chat + excel; previous chats shows only chat | I | `tests/integration/import.test.ts` |
| 26 | Neon unavailable → 503 "Unable to save", nothing claimed saved | I | `tests/integration/chat.test.ts` |
| 27 | Sidebar: new chat, reopen previous, refresh restores, delete with confirm/cancel, all bookings | E | `tests/e2e/history.spec.ts` |
| 28 | Upload clean + planted-error workbook, open failed booking drawer | E | `tests/e2e/upload.spec.ts` |
| 29 | Mobile drawer and keyboard navigation | E | `tests/e2e/history.spec.ts` |
| 30 | Production: no login, both modes, isolation between two cookie jars, no secrets in bundle | L | `scripts/smoke.ts` |
