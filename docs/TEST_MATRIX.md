# Test matrix

Layers: **U** = Vitest unit (pure functions, injected UK clock), **I** = Vitest integration through the real
route handlers against the isolated Neon `dev` branch, **E** = Playwright against a local production build
(`next start`, deterministic fake extractor), **L** = live checks (real Gemini; deployed URL).

| # | Scenario | Layer | File |
|---|---|---|---|
| 1 | BK-001 template fixture passes all 10 rules; Carrier A £540, 5 days, 206.67 kg/pallet; valid only while UK date ≤ 5 Nov 2026 | U | `tests/unit/engine.test.ts` |
| 2 | R-01 pass/fail: blank, 4 digits, numeric 691200, dotted `6912.00`, non-digits, unknown → not evaluable | U | `tests/unit/rules.test.ts` |
| 3 | R-02 exact 1% passes both ways, 1% ± 1p fails, fractional prices, zero sum, multi-item, required wording | U | `tests/unit/rules.test.ts` |
| 4 | R-03 required wording and both fixes; non-divisible quantity; several failing items | U | `tests/unit/rules.test.ts` |
| 5 | R-04 booking vs item cartons | U | `tests/unit/rules.test.ts` |
| 6 | R-05 1,800 kg / 3 → B £660 with exclusions; 500 kg boundary; no-fit → ceil suggestion; chosen too-light carrier; missing priority | U | `tests/unit/carriers.test.ts` |
| 7 | R-06 synonyms (power bank, Li-ion, LiPo, aerosol, spray paint, flammable solvent, acetone…) and negations (battery-free, non-aerosol, no batteries) + ambiguous cue | U | `tests/unit/hazmat.test.ts` |
| 8 | R-07 400 < 540 kg wording; equality passes | U | `tests/unit/rules.test.ts` |
| 9 | R-08 warehouse/no appointment; business address exempt | U | `tests/unit/rules.test.ts` |
| 10 | R-09 blank vs unknown | U | `tests/unit/rules.test.ts` |
| 11 | R-10 today passes / yesterday fails; Europe/London across BST/GMT changes | U | `tests/unit/rules.test.ts`, `tests/unit/dates.test.ts` |
| 12 | Carrier: 4 priorities × 3 countries, balanced scores (0.40/0.65/0.60), tie-breaks, single eligible | U | `tests/unit/carriers.test.ts` |
| 13 | Status: Draft / Blocked / Needs attention / Ready; input errors block; R-06 keeps a tentative carrier | U | `tests/unit/engine.test.ts` |
| 14 | Not evaluable when inputs missing (never "pass") | U | `tests/unit/engine.test.ts` |
| 15 | XLSX: example rows skipped only when unchanged; genuine BK-001 kept; header row 1 or 2; Excel date cells; numeric/text HS; extra rate tab ignored; duplicates; orphans; bad pairs; malformed dates; negatives; missing sheet/column; junk file | U | `tests/unit/import.test.ts` |
| 16 | Planted workbook: each booking fails exactly its rule; BK-212 = 2 Red + 1 Amber | U | `tests/unit/import.test.ts` |
| 17 | Chat patches: increment 3→4 keeps everything else; no-guess increment; France+Paris net change; city outside list; item by SKU/id; remove; blanks; normalisation; invalid values; carrier selection; malformed model output rejected by Zod | U | `tests/unit/patch.test.ts` |
| 18 | Question planning: 2–3 related fields, never a known one; walks to completion with no repeats; reply quotes recomputed cost | U | `tests/unit/missing.test.ts` |
| 19 | UK date parsing: `5 Nov`, `November 5th`, `05/11`, explicit years, recently-passed → confirm year, year-end roll, relative words, impossible dates | U | `tests/unit/dates.test.ts` |
| 20 | Migrations applied; seed run twice → exactly 9 carriers + 10 rules with fixture parity | I | `tests/integration/reference.test.ts` |
| 21 | Session: HttpOnly SameSite=Lax cookie, `__Host-`+Secure over HTTPS, only SHA-256 stored, token never in JSON, Origin required, expired → 401, reset deletes | I | `tests/integration/session.test.ts` |
| 22 | Atomic commit; stale revision → conflict with no partial write; duplicate requestId replays identical response once; concurrent writers → exactly one wins; mid-transaction failure rolls back everything; item ids can't move between bookings | I | `tests/integration/transactions.test.ts` |
| 23 | Evaluation snapshots per revision tagged with engine/rate-card/rulebook versions | I | `tests/integration/evaluation.test.ts` |
| 24 | Chat API: opening message extracts facts and asks only missing; complete → Ready; +1 pallet → £720/155 kg once despite retry; 409 stale; France/Paris recompute; AI failure 503 saves nothing; DB outage 503 "Unable to save"; edit + confirm | I | `tests/integration/chat.test.ts` |
| 25 | History API: two independent chats, order, reopen transcript, continue first only; empty chats hidden; chat + message pagination; All bookings shows chat + Excel; delete keeps imports; cross-session denial on list/read/page/continue/delete; input bounds | I | `tests/integration/chat.test.ts` |
| 26 | Import API: persist + reopen without re-upload; row-scoped issues; valid rows still import; non-xlsx/cross-site/no-session rejected; imports invisible to other sessions and excluded from Previous chats | I | `tests/integration/import.test.ts` |
| 27 | Real Gemini through `POST /api/chat`: opening + "+1 pallet" (opt-in `RUN_LIVE_AI=1`) | L | `tests/integration/gemini-live.test.ts` |
| 28 | Browser: two chats, sidebar reopen, full transcript, continue, refresh restore, other-browser denial, delete cancel/confirm, upload + All bookings + chat-only sidebar | E | `tests/e2e/history.spec.ts` |
| 29 | Browser: rail collapse; mobile history drawer; mobile Conversation/Booking tabs | E | `tests/e2e/history.spec.ts` |
| 30 | Browser: upload planted file, counts, example-row notice, search, BK-212 drawer findings, status filter, refresh | E | `tests/e2e/upload.spec.ts` |
| 31 | Production smoke: no login, both modes, two cookie jars isolated, no secrets in client bundle | L | `scripts/smoke.ts` |
