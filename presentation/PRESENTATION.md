# ShipmentOS hackathon deck: narrative, speaker notes, demo script and evidence audit

Files: `ShipmentOS_Hackathon_Deck.pptx` (editable, native shapes and text, speaker notes on every slide) and `ShipmentOS_Hackathon_Deck.pdf`.

Sources: the case PDF (authoritative for the problem), the ShipmentOS repository and the live deployment (authoritative for what was built), and the repo's PRD (intent only). Screens were captured from production on 26 October 2026 (Vercel deployment of commit `84d73ea`).

## 1. Slide-by-slide narrative

| # | Headline | Purpose |
|---|---|---|
| 1 | From shipment details to dispatch-ready decisions | Establish the product and value proposition in ten seconds, with real screens. |
| 2 | One small form mistake becomes a customs hold or a missing pallet | Make the problem concrete and tie each pain point to the case PDF and rulebook. |
| 3 | Two ways in. One engine behind them. | Show two doors into one shared engine, and why that matters. |
| 4 | From one sentence to a reviewed booking | Walk one coherent example through the real UI: describe, change, review, revisit. |
| 5 | AI interprets the request. Deterministic code verifies the shipment. | Explain the architecture and the principle: AI interprets, deterministic code verifies. |
| 6 | One booking. Ten checks. Clear fixes before dispatch. | Show the ten rules, a worked R-03 example, and the carrier ranking method. |
| 7 | Not a chatbot on a form: four decisions that change the outcome | Show four engineering decisions and what each gives the user. |
| 8 | A working product you can open now | Prove it exists, show verified evidence, label the roadmap as future. |

## 2. Speaker notes (also embedded in the PPTX)

### Slide 1: From shipment details to dispatch-ready decisions

PURPOSE: Establish what ShipmentOS is in ten seconds.

SAY: "Booking a cross-border shipment means long, confusing forms, and small mistakes in them are what get goods stuck at customs or units reported missing at the warehouse. ShipmentOS is two doors into one checking engine. Door one: you describe the shipment in a sentence and it asks only for what's missing. Door two: you upload an Excel workbook and every booking in it is checked. Either way you get what's wrong, how serious it is, how to fix it and which carrier to use, before anything leaves the dock."

POINT AT: the two screens on the right are the real deployed app, not mock-ups: a chat after the seller changed 3 pallets to 4, and the pre-flight result for a booking flagged by the carton rule.

EVIDENCE: all screens captured from the live deployment (Vercel production, commit 84d73ea). ShipmentOS is a booking-preparation and pre-flight tool; it does not contact carriers.

### Slide 2: One small form mistake becomes a customs hold or a missing pallet

PURPOSE: Make the problem concrete and tie it to the hackathon PDF.

SAY: "The case PDF puts it plainly: small mistakes in long, confusing booking forms cause most of the pain later: goods held at customs, or units reported missing at the receiving warehouse, and sellers often only find out days later when their stock is already stuck. Read across the journey. Early on, facts go missing: no HS code, no country of origin, a hazardous item nobody flagged. In the forms, the numbers disagree: this mug booking declares 1,080 units but 12 units a carton times 80 cartons is only 960. At the carrier step, a pallet can be heavier than the service accepts, or the warehouse slot was never booked, and picking the right carrier means trading cost against speed against reliability. Every red or amber tag on this slide is one of the ten rules in the hackathon rulebook."

NOTE: no statistics are quoted because none come from the case material. The consequences are the PDF's own wording.

### Slide 3: Two ways in. One engine behind them.

PURPOSE: Show the product concept and why one shared engine matters.

SAY: "There are two independent ways in. You can chat: describe the shipment and answer a couple of questions; no file needed. Or you can upload the Bookings and Items workbook; no chat needed. You never have to do both. Both doors feed the same layer: a structured booking, the ten rulebook checks, a carrier recommendation, and a plain-English result."

WHY ONE ENGINE (the key point): the hackathon tests the same booking from both directions: conversationally and via file. If each path had its own logic they could disagree. In ShipmentOS both paths produce the same canonical booking and call one evaluation function, so a booking gets the same verdict whichever door it came through, and every rule is written once.

ACCURACY NOTE: template-format Excel uploads are parsed and checked without any AI. Gemini only appears in the chat door (and in an optional fallback that reads non-template workbooks dropped into a chat).

### Slide 4: From one sentence to a reviewed booking

PURPOSE: Let the judges see the real experience, following one coherent example.

DEMO STORY (matches the live demo script):
1. Describe it: the seller types "I want to send 3 pallets of ceramic mugs from Manchester to a warehouse in Frankfurt, ready on 5 November. Cheapest please." ShipmentOS pulls out the route, destination type, date, priority and pallets, notes it assumed the year, and asks only for the next missing details (seller, SKU, quantity).
2. Change your mind: after the details are in and all ten checks pass (Carrier A, 3 x £180 = £540), the seller says "Actually, make that 4 pallets." The reply is "pallets 3 → 4", the price recomputes to £720 (155 kg per pallet), and nothing else is re-asked.
3. See the verdict: for Excel files (or any chat booking) the result shows ten check tiles, which rule failed, the numbers, the fix and what happens next. Shown here: BK-203 from the planted-errors test workbook.
4. Come back later: the All bookings page lists chat and Excel bookings together with Drafts / Sync to ERP / Completed tabs and counts, a date filter and search; every row has Open and Delete, and any booking can be reopened and edited.

HONESTY NOTES: the BK-001 values (3 pallets, 90 cartons, 1,080 mugs, 620 kg, £5,400, Manchester → Frankfurt, 5 Nov 2026) are the example row from the case template. The "Send to ERP" button on the booking page logs the booking as completed inside ShipmentOS; it is not a carrier or real-ERP integration.

### Slide 5: AI interprets the request. Deterministic code verifies the shipment.

PURPOSE: Show how it works inside, and why the architecture was chosen.

SAY: "Gemini understands the seller's request. Zod validates its structure. Neon preserves the booking state. TypeScript independently verifies the shipment."

WALK THE DIAGRAM left to right:
- The browser is Next.js 16 and React 19 with Tailwind. It talks to Next.js API routes; there is no login, just an anonymous HttpOnly cookie that scopes everything to that browser.
- Chat door: the message goes to Gemini (gemini-3.5-flash), which returns a small list of typed patch operations (set, increment, add item, remove...). It does not compute totals, rule verdicts, carriers or dates. Zod validates every operation and malformed output is rejected, with one automatic repair retry; the patch engine then applies it to the booking.
- Excel door: ExcelJS reads the Bookings and Items sheets, Zod validates the rows, and problems with the file itself are reported separately from rule failures. No AI involved for template files.
- Both doors produce the same canonical booking. The TypeScript engine then runs the ten rules with exact decimal arithmetic, ranks the carriers and writes the plain-English result.
- Neon stores bookings, items, chat messages, numbered revisions and evaluations through Drizzle, in one transaction per turn. The rate card (9 rows) and rulebook (10 rows) are seeded from the case sheets; the app refuses to evaluate if they ever diverge from the checked-in copy.

WHY IT MATTERS: consistency (same input, same verdict), explainability (every finding shows actual versus expected and a fix), reliability (if Gemini is down, Excel and the Edit booking form still work).

VERIFIED AGAINST THE CODE: Next.js 16.4, React 19.3, Tailwind 4, Zod 4, ExcelJS, @google/genai, Drizzle, pg, Neon, Vitest, Playwright, Vercel (package.json, lib/ai/extract.ts, lib/domain/*, lib/db/schema.ts, docs/DEPLOYMENT.md). UI components are hand-built (native dialog), not a component library.

### Slide 6: One booking. Ten checks. Clear fixes before dispatch.

PURPOSE: Showcase the core decision engine: ten rules, a concrete example, and how the carrier is chosen.

LEFT: the ten rules are exactly the case rulebook (sheet 4): five Red ("must not go until fixed") and five Amber ("risky, should be fixed or checked"). Every rule is always reported: pass, fail, or "not evaluable" when the inputs aren't known yet. A rule is never shown as passed just because data is missing.

MIDDLE (worked example, from the planted-errors test workbook, BK-203): the item declares 1,080 units. 12 units per carton times 80 cartons is only 960. R-03 fails, it is Red, so the booking is Blocked. The fix is specific and goes both ways: change cartons to 90, or change the quantity to 960, after checking physical stock. ShipmentOS never rewrites the seller's data silently. The panel at the bottom is the real output from the deployed app.

RIGHT (the actual ranking logic in lib/domain/carriers.ts):
1. Route filter: only services on UK to the destination country.
2. Weight filter: gross weight divided by pallets must not exceed the service's max kg per pallet. Ineligible services are removed BEFORE ranking, so a service that can't carry the load can never be recommended, however cheap.
3. Rank by the seller's priority. Cheapest = lowest total cost (pallets x price). Fastest = fewest transit days. Most reliable = highest on-time %. Balanced = 40% cost + 30% speed + 30% reliability, each scaled 0 to 1 across the eligible options. Tie-break: cheaper, then faster, then more reliable.
The Balanced weights are our own decision; the case only says Balanced means "no strong preference, best trade-off". Say so if asked.

NUMBERS (rate card from the case template): Germany A £180 / 5 days / 92% / 500 kg per pallet; B £220 / 3 days / 95% / 750 kg; C £340 / 2 days / 98% / 400 kg. For 3 pallets and 620 kg (206.67 kg per pallet) all three fit: A £540, B £660, C £1,020. Balanced scores work out at A 0.40, B 0.65, C 0.60, so Balanced picks B. At 1,800 kg (600 kg per pallet) A and C are excluded and B (£660) is the only option.

CAVEAT: this is booking-preparation checking, not customs clearance. R-06 is a phrase screen, not a regulatory dangerous-goods classifier.

### Slide 7: Not a chatbot on a form: four decisions that change the outcome

PURPOSE: Show this is engineered, not merely a chatbot placed on top of a form. Each decision is tied to what it gives the user.

1. TYPED PATCHES, NOT A RESTART. Gemini returns operations like "increment pallets by 1", not a fresh booking. The app applies them to the saved draft, so "Actually, make that 4 pallets" keeps everything else. Each turn is saved atomically with a revision number; resending the same request applies once; a stale edit is rejected with a conflict instead of overwriting. (Test matrix scenario 22 and 24.)

2. RULES DECIDE, AI NEVER DOES. All arithmetic runs in exact integer math at 1/10,000 precision, so the 1% tolerance in R-02 is exact, not floating point. Findings carry actual and expected values and a concrete fix, which is what the judges asked for: "what is wrong, how serious it is, and how to fix it".

3. ONE SHARED ENGINE. Chat and Excel produce the same canonical booking and call the same evaluation function (lib/domain/evaluate.ts). Fixing a rule once fixes both doors.

4. SAVED, VERSIONED, NO LOGIN. The case requires that the link works without help or a login. ShipmentOS uses an anonymous HttpOnly cookie; only a hash of it is stored; sessions expire 7 days after the last visit; "Reset my data" deletes everything immediately. Bookings, messages, revisions and evaluations persist in Neon so a chat or upload can be reopened later.

No named competitors are compared; the left column is a generic manual process.

### Slide 8: A working product you can open now

PURPOSE: Close with proof it exists, what was verified, and where it goes next.

SAY: "This is live right now: shipmentos-preflight.vercel.app, no login, and the repository is public. Scan the code to try it. On 26 October 2026 we ran 112 unit tests and 51 integration tests (route handlers against a Neon test branch), and a 28-check smoke test against the live production URL; all passed."

EVIDENCE (collected 26 October 2026 and re-runnable): 112 Vitest unit tests passed (10 files); 51 Vitest integration tests passed with 3 skipped (the 3 skipped are the opt-in live-Gemini test and are not counted), run against the isolated Neon dev branch with the deterministic fake extractor; 28 of 28 checks passed in scripts/smoke.ts against the production URL (run twice, the second time against commit 84d73ea) (public access, no secrets in client bundles, real Gemini extraction, +1 pallet to £720, idempotent retry, 409 on stale revision, both uploads, cross-session isolation). A Playwright end-to-end suite exists in tests/e2e but was NOT re-run for this deck. The unit test run used the local working tree, which has uncommitted changes that are not yet deployed.

WHAT WAS DEMONSTRATED: chat booking with follow-up questions, a mid-conversation change, Excel upload with planted errors, all ten rules with fixes, carrier recommendation by priority, and saved bookings that can be reopened.

FUTURE OPPORTUNITIES (explicitly NOT built): real carrier booking, commercial-invoice and document generation, more routes, shipment tracking, deeper customs integrations. Today ShipmentOS prepares and checks a booking; the seller still submits it to a carrier themselves.

LIMITS TO STATE IF ASKED: R-06 is a phrase screen, not a dangerous-goods classifier; indicative delivery is collection plus transit in calendar days, not a carrier schedule; history is per browser; no usage or accuracy numbers are claimed because none have been measured.

CLOSE: "Book it in a sentence. Check it before it ships."

## 3. Pitch and demo script (about 3.5 minutes live)

Use the live app at https://shipmentos-preflight.vercel.app in a fresh browser window. No login. Values below are the case template's own example (BK-001) unless marked illustrative.

**0:00 – Open (slides 1–3, ~60 s).** Say the problem in the PDF's words (small form mistakes, found days later). Show the two doors and the single engine.

**1:00 – Door one, chat (~75 s).** Click *New booking → Chat*.
1. Type: `I want to send 3 pallets of ceramic mugs from Manchester to a warehouse in Frankfurt, ready on 5 November. Cheapest please.` Point out what it filled in (route, warehouse, date, priority, pallets) and that it asks only for the rest.
2. Type: `Seller is Northfield Goods. SKU MUG-01, 1080 mugs, 12 units each, 90 cartons, £5 each, 0.5 kg each, HS 691200, made in United Kingdom. Gross weight 620 kg, declared £5400, 90 cartons in total. I have booked the appointment.` All ten checks go green; Carrier A, 3 × £180 = £540, 206.67 kg per pallet.
3. Type: `Actually, make that 4 pallets.` It replies "pallets 3 → 4", £720, 155 kg per pallet; nothing else is re-asked.
(Gemini-dependent: have the screenshots on slide 4 as a fallback if the network is slow.)

**2:15 – Door two, Excel (~60 s).** Click *Master Data* in the sidebar (the Excel upload page; the route is `/upload`) and drop `tests/fixtures/planted-errors.xlsx` (12 bookings, synthetic, in the repo). Show the counts (7 Blocked, 4 Needs attention, 1 Ready). Open BK-203: R-03, `12 units/carton × 80 cartons = 960` vs 1,080 declared, with the two-way fix and the carrier card. Optionally open BK-205 (1,600 kg on one pallet: no carrier can take it, suggests 3 pallets).

**3:15 – Close (slides 6–8, ~30 s).** The carrier ranking method (filter, then rank, Balanced is 40/30/30). Show the test evidence and QR code. End: *Book it in a sentence. Check it before it ships.*

The app's sidebar item was renamed *Upload Excel → Master Data* after the first capture; the screens in the deck are from the renamed build. Tidy up after a demo with *Reset my data* in the sidebar.

## 4. Capability audit (what the deck is allowed to claim)

Status key: **Full** = built and verified; **Partial** = built with a caveat; **Planned** = not built.

| # | Capability | Status | Evidence |
|---|---|---|---|
| 1 | Chat-based booking creation | Full | Live capture on production; `scripts/smoke.ts` (Gemini extraction, completion). |
| 2 | Multi-turn conversation | Full | Live capture: opening, details, follow-up questions; integration tests `chat.test.ts`. |
| 3 | Mid-conversation modification | Full | Live: 3 → 4 pallets, £540 → £720, 155 kg per pallet; retried request applies once; stale revision returns 409 (smoke). |
| 4 | Automatic missing-field detection | Full | 20-item details checklist with a "Next" marker; unit tests `missing.test.ts`. |
| 5 | Excel upload and multi-booking validation | Full | Live: `planted-errors.xlsx` gave 12 bookings, 7 Blocked, 4 Needs attention, 1 Ready. |
| 6 | All ten pre-flight rules | Full | One unit test group per rule; the planted workbook fails exactly one rule per booking. Caveat: R-06 is a phrase screen, not a dangerous-goods classifier. |
| 7 | Explanations and recommended fixes | Full | Result page shows actual vs expected, the fix and next steps (slides 4 and 6). |
| 8 | Carrier recommendation by priority | Full | `lib/domain/carriers.ts`; rate card seeded from the case sheet (9 rows). The 40/30/30 Balanced weights are the team's own decision. |
| 9 | Persistence in Neon | Full | Health check reports the database reachable; smoke test reads back transcripts and bookings; schema in `docs/DB_SCHEMA.md`. |
| 10 | Visible chat-history sidebar with resume | **Partial** | The deployed UI has no "Previous chats" sidebar any more. Navigation is Dashboard, Master Data and All bookings; chat bookings appear in All bookings (tabs: All, Completed, Sync to ERP, Drafts) with an Open button on every row. Transcript resume is covered by the API smoke test. The README and PRD still describe the older sidebar. The deck says "All bookings", not "sidebar". Not re-verified: clicking from All bookings back into the chat view in the current build. |
| 11 | Booking history and revision tracking | Full (storage) | Every change writes a numbered `booking_revisions` row with before/after, and the booking panel has a change log. The deck mentions it but does not show a revision screen. |
| 12 | Public access without login | Full | Smoke test: public, no auth wall. Preview deployments keep Vercel Authentication by design; production is public. |
| 13 | Loading, error and recovery states | Full (tested, not shown) | AI failure returns 503 and saves nothing; database outage shows "Unable to save"; Edit booking works without Gemini (integration tests). Not demonstrated live. |
| 14 | Automated testing and deployment | Partial | 112 unit and 51 integration tests pass; production smoke 28/28. Deployment is Vercel continuous deployment from `main`. There is no CI workflow in the repo, and the Playwright end-to-end suite was not re-run for this deck. |

## 5. Evidence gaps and cautions

- **No traction, accuracy, speed or savings figures** are in the deck because none exist in the sources.
- **No real carrier integration.** The booking page's *Send to ERP* button only marks the booking Completed inside ShipmentOS. The deck says nothing is sent to a carrier.
- **Validation is not customs clearance.** The deck says so on slides 6 and 8.
- **Uncommitted work.** The UI moved while this deck was being made (stage tabs, the *Master Data* rename). The screens were recaptured from commit `84d73ea`, the production deployment at that time. The 112 unit and 51 integration tests ran on the local working tree, which also carried small uncommitted edits to `components/chat/chat-workspace.tsx` and `tests/e2e/hybrid.spec.ts`. If the UI changes again before judging, recapture the screens on slides 1, 4 and 6.
- **Integration tests** ran against the project's Neon `dev` branch with the deterministic fake extractor; the opt-in live-Gemini test was skipped (3 skipped tests). Real Gemini was exercised by the production smoke test.
- **Template-file Excel upload uses no AI.** Gemini also appears in an optional fallback that reads non-template workbooks inside a chat, and in voice input; neither is part of rule decisions.
- **Rate card source.** The nine carrier rows come from the case's template workbook (seeded into Neon); the PDF itself points to the template for the full rate card.
- **Data cleanup.** Screenshot capture and the smoke test (run twice, the second time on commit `84d73ea`) used synthetic data in disposable anonymous sessions, which were reset afterwards.
