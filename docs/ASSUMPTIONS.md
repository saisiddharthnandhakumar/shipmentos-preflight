# Assumptions and design decisions

Each item says where it comes from: **[PDF]** case PDF, **[XLSX]** test-data template, **[Owner]** project owner's PRD/prompt, **[Decision]** our own choice where the sources are silent.

## Source facts we rely on

- [XLSX] Sheet names: `Bookings`, `Items`, `Carrier options`, `Rulebook`, `Allowed values`, `Field guide`, `Glossary`. Row 1 is an instruction line, row 2 has headers, row 3 is the grey example `BK-001` / `MUG-01`.
- [PDF] "Judges will upload only Sheets 1 and 2, in exactly this structure." Carrier options and rulebook are fixed, so they are seeded into Neon and never read from uploads.
- [XLSX] Dates in the example are text `05-11-2026` (format `DD-MM-YYYY`); HS code is stored as a number (`691200`).
- [XLSX] Field guide: HS code and item country of origin may be blank (that is how R-01/R-09 are tested). All other columns are required.
- [PDF/XLSX] Allowed values: origin United Kingdom (London, Manchester, Birmingham, Leeds); destinations Germany (Berlin, Frankfurt, Hamburg), France (Paris, Lyon), Netherlands (Amsterdam, Rotterdam); GBP only; item origins United Kingdom, China, India, Vietnam, Turkey, Germany.
- [XLSX] Glossary: Red = "must not go until fixed"; Amber = "risky, should be fixed or checked".

## Rule interpretation

| Rule | Decision |
|---|---|
| R-01 | [Decision] Strip spaces and dots (`6912.00` → `691200`), then require `^\d{6,}$`. Excel numeric HS codes are converted with no decimals (`691200.0` → `691200`). Blank fails. Leading zeros are preserved for text cells; a numeric cell cannot carry leading zeros, so `0101210` typed as a number becomes `101210` (6 digits, passes) — documented limitation of the template's "Number" format. |
| R-02 | [Decision] Exact integer arithmetic at 1/10,000 GBP. Pass when `|declared − Σ(qty × unit price)| ≤ 1% × Σ`. If Σ is 0, declared must also be 0. |
| R-03 | One finding per failing item; the fix offers both directions (change cartons or change quantity) and never edits the seller's data. When quantity is not divisible by units/carton the cartons suggestion is "not a whole number". |
| R-04 | Booking cartons vs Σ item cartons; difference reported both ways. |
| R-05 | [Decision] "Chosen carrier" = the carrier the seller explicitly selected (chat/edit), otherwise the recommended carrier. Eligibility filters by weight first, so a recommended carrier always passes; if **no** carrier on the route fits, R-05 fails with `ceil(gross ÷ 750)`-style suggestion (max capacity on the route). If seller priority is unknown and no carrier is explicitly selected, R-05 is Not evaluable unless no carrier fits at all (then it fails). |
| R-06 | [Decision] Deterministic phrase matching on item descriptions (and SKU) for lithium batteries, aerosols and flammable liquids with common synonyms (power bank, Li-ion, LiPo, lithium-ion, aerosol, spray paint, spray can, flammable solvent, petrol, acetone, lighter fluid, …). Negations such as `battery-free`, `non-aerosol`, `non-flammable`, `no battery`, `without batteries` suppress the match. Ambiguous words (`battery`, `spray`, `solvent`, `perfume`) produce an **unscored clarification note**, not a Red finding. This is not a regulatory dangerous-goods classifier. |
| R-07 | Gross ≥ Σ(unit kg × qty); exact at 1/10,000 kg. |
| R-08 | Only `Warehouse` requires `Yes`; `Business address` is exempt (rule passes). |
| R-09 | Blank/whitespace country of origin fails per item. A non-blank value outside the allowed list is an input warning (not R-09). |
| R-10 | Compare the ready date to today's **Europe/London** calendar date (injected clock in tests). Today passes. |

## Status and readiness

- [Owner] Input errors or any Red → Blocked; else any Amber → Needs attention; else Ready to submit. Chat bookings with missing details → Draft (rule counts still shown).
- [Decision] Proposed collection date = ready-to-ship date (or today if the ready date is past). Indicative delivery = collection + transit days, **calendar days**, labelled "indicative".
- [Decision] Status of a confirmed draft does not freeze: any later edit recomputes and clears the confirmation.

## Carrier ranking

- [Owner] Balanced score = 0.40 cost benefit + 0.30 speed benefit + 0.30 reliability benefit, each min–max normalized across **eligible** options; a dimension where all eligible options tie scores 0.5.
- [Owner] Tie-break order: cheaper → faster → more reliable → stable key (`GB-DE-A` …).
- [Decision] Cost uses exact pence arithmetic; on-time % compared as numbers.

## Chat

- [Owner] Gemini returns a list of typed operations, validated with Zod. One repair retry, then a recoverable error (the user can retry or use the Edit form). The model never sets status, rule results, costs, carrier ranking or computed dates.
- [Decision] Dates: Gemini copies the seller's date wording verbatim; code parses it. UK day-first order (`05/11` = 5 November). A date without a year resolves to the next occurrence on or after today (UK) and is shown as "year assumed". If that would push a date that passed in the last 60 days into next year, we keep the current year and ask the seller to confirm (R-10 will flag it).
- [Decision] Assistant replies are generated deterministically from computed state (what changed, what is still missing, current status). This keeps one Gemini call per turn and makes replies testable.
- [Decision] City–country consistency: setting a destination city implies its country; changing the country to one that does not contain the current city clears the city and asks for it again.
- [Decision] Unknown origin/destination cities outside the allowed list are rejected with a clarification ("we can ship from London, Manchester, Birmingham or Leeds").
- [Decision] A chat thread is created on the first message (`POST /api/bookings` with an idempotency key), so `+ New chat` never creates empty history rows.

## Upload

- [Decision] The example row is skipped only if every Bookings (or Items) cell equals the template example exactly; the skip is reported in the import summary.
- [Decision] Duplicate Booking IDs: the first occurrence is imported and flagged Blocked with an input issue; later rows with the same ID are reported and not imported, because their items cannot be attributed unambiguously.
- [Decision] Items whose Booking ID matches no booking are reported as orphan items. Bookings with no items are Blocked with an input issue (item rules are Not evaluable).
- [Decision] Limits: 5 MB file, 2,000 bookings, 10,000 items, 200 items per booking.

## Persistence, sessions, retention

- [Owner] Neon Postgres is required. Money and weights are `numeric(14,4)`; counts are integers; ready date is SQL `date`.
- [Decision] Sessions expire 7 days after last use (sliding). Expired sessions cannot read anything. Cleanup of expired sessions is **best-effort on access** (each new session creation deletes up to 50 expired sessions and their cascaded data). There is no cron job. "Reset my data" deletes the session and everything it owns immediately.
- [Decision] Rate limits are in-memory per server instance (best-effort on serverless), plus hard per-thread message caps (300 messages) enforced in the database layer.
- [Decision] Runtime loads the rate card and rulebook from Neon and refuses to evaluate if they diverge from the checked-in source-derived fixture (`lib/domain/reference.ts`).
