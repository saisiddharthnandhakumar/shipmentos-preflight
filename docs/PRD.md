# ShipmentOS — Product Requirements (implementation edition)

ShipmentOS is a no-login web app that helps a UK seller prepare a cross-border pallet shipment to
Germany, France or the Netherlands and catches mistakes **before** the shipment leaves. It is a
booking-preparation and pre-flight checking demo. It never books a real carrier.

Sources of truth (not committed to this repo):

| Source | What it fixes |
|---|---|
| Case PDF "Ops Hackathon – Case 2 Shipment Booking & Error Checker" | Problem statement, two test parts (conversation without file, upload without chat), allowed values, rulebook, what judges expect to see per booking |
| `Case2_Shipment_Booking_Test_Data_Format.xlsx` | Exact sheet/column names, example row BK-001, carrier rate card (9 rows), rulebook (10 rows), allowed values, field guide, glossary |
| Project owner's PRD v3 | Neon persistence, anonymous sessions, visible previous-chat sidebar, booking history, delete, resume (owner requirements, not PDF rules) |

## 1. Users and jobs

- **Seller** — "Let me describe what I'm sending, ask me only for what's missing, tell me what's wrong and which carrier to use."
- **Operations reviewer** — "Let me upload many bookings and immediately see which need fixing, why, and how."
- **Judge** — "Let me change a detail mid-conversation and see everything recompute; let me upload planted-error files; no login."

## 2. Two independent entry modes, one engine

```
Chat to book ──► Gemini → typed patch → Zod ─┐
                                             ├─► canonical Booking + Items ─► 10-rule engine ─► carrier ranker ─► status + next steps ─► Neon
Upload Excel ──► ExcelJS → column map → Zod ─┘
```

- Chat never requires a file. Upload never requires chat or Gemini.
- Gemini only converts a message into patch operations. Rule verdicts, arithmetic, carrier eligibility and ranking, dates and status are all computed in TypeScript.

## 3. Functional requirements (P0)

### 3.1 Chat to book
1. Extract every field the seller states; never guess unknown values (no invented HS codes, weights, quantities).
2. Compute missing fields deterministically and ask for 1–3 related ones at a time; never re-ask a filled field.
3. Apply corrections as minimal patches: `set`, `increment`, `remove`, `addItem`, `updateItem`, `removeItem`. "Add one pallet" is `increment pallets +1`.
4. After every patch: normalize → missing fields → all rules with known inputs → carrier recommendation → templated reply that names what changed.
5. Atomic persistence per turn: booking + items + user/assistant messages + revision + evaluation, guarded by `expectedRevision` (409 on stale) and idempotent on `(booking_id, request_id)`.
6. Direct "Edit booking" form uses the same version-safe write path, so the seller can continue when Gemini is unavailable.
7. When complete, show an honest **Ready to submit / Needs attention / Blocked** confirmation with proposed collection date, indicative delivery date and next steps. Never "booked".

### 3.2 Previous chats and booking history (owner P0)
- Left rail: `+ New chat`, `Previous chats` (Neon-backed, newest activity first, deterministic route title, status, last activity), `All bookings`, `Upload Excel`. Mobile: accessible drawer.
- Reopening a chat restores the full transcript (paginated "Load earlier messages"), the canonical booking/items, revision, missing fields, findings and carrier.
- `/chat/[bookingId]` survives refresh within the same anonymous browser session.
- `+ New chat` never erases earlier chats. Empty chats are not persisted until the first message.
- `Delete conversation` (with confirmation) removes only that owned chat and its dependent rows.
- `All bookings` lists chat **and** Excel bookings. Excel bookings never get synthetic chat messages.

### 3.3 Upload Excel
- Accept `.xlsx` ≤ 4 MB, ≤ 2,000 booking rows, ≤ 10,000 item rows.
- Find `Bookings` and `Items` sheets by name; locate the header row by content (row 1 or 2+).
- Skip the template's grey example row only when it exactly equals the instructional BK-001/MUG-01 example; report the skip.
- Parse `DD-MM-YYYY` text and Excel date cells; HS code as number or text; keep original row numbers and raw values.
- Report **Input issues** (missing sheet/column, duplicate Booking ID, orphan items, booking with no items, malformed dates, invalid enums, invalid city–country pairs, negative/non-integer counts) separately from rule findings, without dropping other records.
- Persist one `import_batches` row, the canonical bookings/items, evaluations and row-scoped `import_issues`. No raw workbook bytes.
- Results: summary counts, searchable/filterable list, detail drawer with all ten rules, numeric fixes, carrier, next steps.

### 3.4 Ten-rule engine (exact rulebook)
| ID | Severity | Rule (verbatim from workbook) |
|---|---|---|
| R-01 | Red | Every item must have an HS code of at least 6 digits |
| R-02 | Red | Total declared value must equal the sum of quantity × unit price across all items (within 1%) |
| R-03 | Red | For each item, units per carton × cartons must equal quantity |
| R-04 | Red | Total cartons on the booking must equal the sum of cartons across all items |
| R-05 | Red | Weight per pallet (total gross weight ÷ pallets) must not exceed the chosen carrier's max weight per pallet |
| R-06 | Red | No lithium batteries, aerosols or flammable liquids |
| R-07 | Amber | Total gross weight must be at least the sum of unit weight × quantity across all items |
| R-08 | Amber | Shipments to a warehouse must have a delivery appointment booked |
| R-09 | Amber | Every item must have a country of origin |
| R-10 | Amber | Ready to ship date must not be in the past |

Every rule is always shown: **Pass**, **Red/Amber flagged**, or **Not evaluable** (dependencies missing — never shown as passed).

### 3.5 Carrier recommendation
Route filter (UK → destination country) and weight filter (`gross ÷ pallets ≤ max kg/pallet`) **before** ranking. Cost = pallets × price per pallet. Priorities: Cheapest, Fastest, Most reliable, Balanced (40% cost / 30% speed / 30% reliability, normalized among eligible options). Deterministic tie-breaks. Explanations quote real numbers. If none fits: no recommendation, R-05 blocker, suggested `ceil(gross ÷ max capacity on route)` pallets.

### 3.6 Status
Input errors or any Red → **Blocked**; else any Amber → **Needs attention**; complete with all passing → **Ready to submit**; chat still missing details → **Draft**.

### 3.7 Anonymous sessions and privacy
256-bit random token in an HttpOnly, SameSite=Lax (Secure in production, `__Host-` prefix) cookie; only its SHA-256 hash is stored. Every query is scoped by the cookie-resolved session ID. 7-day sliding expiry, explicit "Reset my data" path, Origin checks on writes, bounded inputs, per-session/IP write rate limits.

## 4. Non-goals
Real carrier booking or pickup APIs, accounts/login, speech input, token streaming, analytics dashboards, cross-device history sync, official customs or dangerous-goods compliance.

## 5. Acceptance
See `docs/TEST_MATRIX.md` for the scenario → automated test mapping and `docs/ASSUMPTIONS.md` for every inferred decision.
