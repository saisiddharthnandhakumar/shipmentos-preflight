/**
 * Live check of the Gemini extractor on the judge-demo phrasings (needs GEMINI_API_KEY).
 * Usage: GEMINI_MODEL=gemini-2.5-flash npx tsx scripts/eval-extractor.ts
 * It prints each message's patch, the resulting facts and latency. Not part of CI.
 */
import "./env";
import { geminiExtractor } from "../lib/ai/extract";
import { evaluateBooking } from "../lib/domain/evaluate";
import { applyPatch } from "../lib/domain/patch";
import { todayUK } from "../lib/domain/dates";
import { emptyDraft, type DraftBooking } from "../lib/domain/schemas";

const turns = [
  "I'm sending 3 pallets of ceramic coffee mugs from Manchester to a warehouse in Frankfurt, ready 5 Nov. Cheapest please.",
  "We're Northfield Goods. It's 1080 mugs, SKU MUG-01.",
  "The cartons are 90, 12 units each. £5 a mug, half a kilo each.",
  "HS code 691200, made in the UK. Total gross weight is 620 kg, declared value £5,400, 90 cartons overall.",
  "I have booked the appointment.",
  "Actually, add one more pallet.",
  "Make it France instead, Paris.",
  "change units per carton to 10",
];

async function main() {
  let d: DraftBooking = emptyDraft();
  const recent: { role: "user" | "assistant"; content: string }[] = [];
  const today = todayUK();
  for (const message of turns) {
    const t0 = Date.now();
    const patch = await geminiExtractor({ message, draft: d, recentMessages: recent });
    const ms = Date.now() - t0;
    const r = applyPatch(d, patch.operations, { todayUK: today, newId: () => crypto.randomUUID() });
    d = r.draft;
    const e = evaluateBooking(d, { todayUK: today });
    console.log(`\n> ${message}\n  ${ms} ms · ops ${JSON.stringify(patch.operations)}`);
    console.log(`  changes: ${r.changes.map((c) => `${c.label} ${c.before}→${c.after}`).join(" | ") || "none"}${r.warnings.length ? `\n  warnings: ${r.warnings.join(" | ")}` : ""}`);
    console.log(`  status ${e.status}; missing ${e.missingFields.map((m) => m.key).join(",") || "none"}`);
    recent.push({ role: "user", content: message });
  }
  console.log("\nFinal:", JSON.stringify({ pallets: d.pallets, dest: `${d.destinationCity}/${d.destinationCountry}`, item: d.items[0] }, null, 0));
}
main().catch((e) => {
  console.error("eval failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
