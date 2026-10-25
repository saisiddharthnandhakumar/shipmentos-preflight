import { describe, expect, it } from "vitest";
import { evaluateBooking } from "@/lib/domain/evaluate";
import { applyPatch } from "@/lib/domain/patch";
import { composeReply, nextQuestionFields, questionFor } from "@/lib/domain/reply";
import { emptyDraft } from "@/lib/domain/schemas";
import { bk001, TODAY, uuid } from "../helpers/builders";

describe("question planning", () => {
  it("asks at most three related fields and never a known one", () => {
    const { draft } = applyPatch(emptyDraft(), [
      { op: "set", field: "pallets", value: 3 },
      { op: "set", field: "originCity", value: "Manchester" },
      { op: "set", field: "destinationCity", value: "Frankfurt" },
      { op: "set", field: "destinationType", value: "warehouse" },
      { op: "set", field: "readyToShipDate", value: "5 Nov" },
      { op: "set", field: "sellerPriority", value: "Cheapest" },
      { op: "addItem", item: { description: "Ceramic coffee mugs" } },
    ], { todayUK: TODAY, newId: uuid });
    const e = evaluateBooking(draft, { todayUK: TODAY });
    const next = nextQuestionFields(e.missingFields);
    expect(next.length).toBeLessThanOrEqual(3);
    expect(next.map((f) => f.key)).toEqual(["sellerName"]);
    const q = questionFor(next, draft);
    expect(q).toBe("What business is sending this?");
    expect(q).not.toMatch(/pallet/i);
  });

  it("walks every missing field to completion without repeats", () => {
    let d = emptyDraft();
    const asked: string[] = [];
    const full = bk001();
    for (let i = 0; i < 30; i++) {
      const e = evaluateBooking(d, { todayUK: TODAY });
      if (!e.missingFields.length) break;
      const next = nextQuestionFields(e.missingFields);
      for (const f of next) {
        expect(asked).not.toContain(f.key);
        asked.push(f.key);
      }
      // Answer the questions from the BK-001 fixture
      const ops = next.map((f) => {
        if (f.key === "items") return { op: "addItem" as const, item: { sku: "MUG-01" } };
        if (f.itemId) return { op: "updateItem" as const, target: { itemId: f.itemId }, changes: { [f.field]: (full.items[0] as Record<string, unknown>)[f.field] } };
        const value = (full as Record<string, unknown>)[f.field];
        return { op: "set" as const, field: f.field as never, value: value as never };
      });
      d = applyPatch(d, ops, { todayUK: TODAY, newId: uuid }).draft;
    }
    const e = evaluateBooking(d, { todayUK: TODAY });
    expect(e.missingFields).toEqual([]);
    expect(e.status).toBe("Ready to submit");
  });

  it("reply after adding a pallet quotes the recomputed cost", () => {
    const before = bk001();
    const prev = evaluateBooking(before, { todayUK: TODAY });
    const r = applyPatch(before, [{ op: "increment", field: "pallets", by: 1 }], { todayUK: TODAY, newId: uuid });
    const e = evaluateBooking(r.draft, { todayUK: TODAY });
    const text = composeReply({ draft: r.draft, evaluation: e, previous: prev, changes: r.changes, warnings: r.warnings });
    expect(text).toMatch(/number of pallets 3 → 4/);
    expect(text).toMatch(/4 × £180 = £720/);
    expect(text).toMatch(/155 kg per pallet/);
    expect(text).toMatch(/was Carrier A Road economy £540/);
    expect(text).toMatch(/no carrier has been contacted/);
  });
});
