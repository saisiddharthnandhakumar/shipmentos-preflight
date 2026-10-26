# ShipmentOS business pitch: 5-minute script and demo

Files: `ShipmentOS_Business_Pitch.pptx` (editable, speaker notes on each slide) and `ShipmentOS_Business_Pitch.pdf`.

## 5-minute pitch (about 650 words, ~35 seconds a slide, demo ~90 seconds)

1. **Intro (20 s).** "International shipping is complicated; booking it shouldn't be. ShipmentOS lets a seller describe a shipment in plain words, checks it before it leaves, and recommends a carrier."
2. **Hidden cost (30 s).** "One wrong quantity, a missing customs code or a mismatched value means goods held at customs or units missing at the warehouse. Then delays, rework and disrupted stock. The hackathon brief says sellers often find out days later, when stock is already stuck."
3. **Where it breaks (30 s).** "Today's journey: gather, fill many fields, reconcile quantities, check documents, compare carriers, submit. The dark steps are where things go wrong, and nothing warns the seller."
4. **Two ways in (30 s).** "Talk to ShipmentOS for one shipment, or upload a spreadsheet for many. You never need both. Either way: a clear review, specific corrections, a recommended carrier."
5. **Conversation (40 s).** "One sentence in. It asks only for what's missing. 'Actually, make that 4 pallets' and the price updates from £540 to £720, nothing re-asked. Less form-filling, more guidance."
6. **Catch problems (40 s).** "1,080 units declared, but 12 per carton × 80 cartons is 960: 120 unaccounted for. That's Red, fix before dispatch. We say how: change cartons to 90 or quantity to 960. Amber is worth a check. And you pick cheapest, fastest, most reliable or balanced."
7. **What changes (30 s).** "Guided booking, clear requirements, early detection, specific fixes, priority-based carrier choice, one organised list. That's efficiency, lower risk and better decisions. These are expected benefits, not measured results yet."
8. **Opportunity (30 s).** "It works today, no login: scan the code. Next: real carrier connections, documents, tracking, more routes, high-volume automation. Those are future. The best time to fix a shipment problem is before it leaves."

## Live demo (about 90 seconds; open https://shipmentos-preflight.vercel.app)

1. **New booking → Chat.** Type: `I want to send 3 pallets of ceramic mugs from Manchester to a warehouse in Frankfurt, ready on 5 November. Cheapest please.` Point out it asks only for what's missing.
2. Type: `Seller is Northfield Goods. SKU MUG-01, 1080 mugs, 12 units each, 90 cartons, £5 each, 0.5 kg each, HS 691200, made in United Kingdom. Gross weight 620 kg, declared £5400, 90 cartons in total. I have booked the appointment.` Ten green checks, Carrier A £540.
3. Type: `Actually, make that 4 pallets.` Price becomes £720; nothing re-asked.
4. **Master Data** (sidebar) → drop `tests/fixtures/planted-errors.xlsx`. Show the counts, open **BK-203** (1,080 vs 960, with the fix and the carrier options).
5. Finish on **All bookings**. Use *Reset my data* (sidebar) afterwards.

Fallback if the network is slow: slides 5 and 6 show the same screens.

## Evidence and honesty

- Screens are real, from the live app (production commit `84d73ea`, 26 Oct 2026). Sample values come from the hackathon's example data.
- No cost, time-saved or adoption figures are claimed. Slide 7 says "expected benefits, not measured results".
- Slide 8 labels carrier connections, documents, tracking, routes and high-volume automation as future opportunities.
- ShipmentOS prepares and checks bookings; it does not contact carriers or replace customs clearance.
