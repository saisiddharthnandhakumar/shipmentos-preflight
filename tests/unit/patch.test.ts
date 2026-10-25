import { describe, expect, it } from "vitest";
import { evaluateBooking } from "@/lib/domain/evaluate";
import { applyPatch } from "@/lib/domain/patch";
import { ChatPatchSchema, emptyDraft, type PatchOp } from "@/lib/domain/schemas";
import { bk001, item, TODAY, uuid } from "../helpers/builders";

const ctx = { todayUK: TODAY, newId: uuid };
const apply = (d: Parameters<typeof applyPatch>[0], ops: PatchOp[]) => applyPatch(d, ops, ctx);

describe("chat patches", () => {
  it("opening message: extracts known facts, does not invent unknowns", () => {
    const r = apply(emptyDraft(), [
      { op: "set", field: "pallets", value: 3 },
      { op: "set", field: "originCity", value: "manchester" },
      { op: "set", field: "destinationCity", value: "Frankfurt" },
      { op: "set", field: "destinationType", value: "a warehouse" },
      { op: "set", field: "readyToShipDate", value: "5 Nov" },
      { op: "set", field: "sellerPriority", value: "cheapest please" },
      { op: "addItem", item: { description: "Ceramic coffee mugs" } },
    ]);
    const d = r.draft;
    expect(d).toMatchObject({ pallets: 3, originCity: "Manchester", destinationCity: "Frankfurt", destinationCountry: "Germany", destinationType: "Warehouse", readyToShipDate: "2026-11-05", readyDateNote: "year_assumed", sellerPriority: "Cheapest" });
    expect(d.sellerName).toBeNull();
    expect(d.totalGrossWeightKg).toBeNull();
    expect(d.items[0]).toMatchObject({ description: "Ceramic coffee mugs", hsCode: null, quantityUnits: null });
    const missing = evaluateBooking(d, { todayUK: TODAY }).missingFields.map((m) => m.key);
    expect(missing).not.toContain("pallets");
    expect(missing).not.toContain("originCity");
    expect(missing).not.toContain("destinationCity");
    expect(missing).toContain("sellerName");
  });

  it('"add one more pallet" increments 3 → 4 and keeps every other fact', () => {
    const before = bk001();
    const r = apply(before, [{ op: "increment", field: "pallets", by: 1 }]);
    expect(r.draft.pallets).toBe(4);
    expect({ ...r.draft, pallets: 3 }).toEqual(before);
    expect(r.changes).toEqual([{ field: "pallets", label: "pallets", before: "3", after: "4" }]);
  });

  it("increment without a known value asks instead of guessing", () => {
    const r = apply(emptyDraft(), [{ op: "increment", field: "pallets", by: 1 }]);
    expect(r.draft.pallets).toBeNull();
    expect(r.warnings[0]).toMatch(/don't have a number of pallets/);
  });

  it('"make it France instead, Paris" updates country and city consistently', () => {
    const r = apply(bk001(), [
      { op: "set", field: "destinationCountry", value: "France" },
      { op: "set", field: "destinationCity", value: "Paris" },
    ]);
    expect(r.draft.destinationCountry).toBe("France");
    expect(r.draft.destinationCity).toBe("Paris");
    const e = evaluateBooking(r.draft, { todayUK: TODAY });
    expect(e.carrier.recommendedKey).toBe("GB-FR-A");
    expect(e.carrier.candidates.find((c) => c.option.key === "GB-FR-A")!.totalCostGBP).toBe(510);
  });

  it("changing only the country clears an incompatible city and asks for one", () => {
    const r = apply(bk001(), [{ op: "set", field: "destinationCountry", value: "France" }]);
    expect(r.draft.destinationCity).toBeNull();
    expect(r.warnings[0]).toMatch(/Frankfurt isn't in France/);
  });

  it("rejects cities outside the allowed list", () => {
    const r = apply(bk001(), [{ op: "set", field: "destinationCity", value: "Madrid" }]);
    expect(r.draft.destinationCity).toBe("Frankfurt");
    expect(r.warnings[0]).toMatch(/isn't one of them/);
  });

  it('"cartons are 90, 12 units each, 1080 mugs" updates the item and re-evaluates R-03/R-04', () => {
    const start = bk001({}, [item({ cartons: 80 })]);
    expect(evaluateBooking(start, { todayUK: TODAY }).rules[2].status).toBe("fail");
    const r = apply(start, [{ op: "updateItem", target: { sku: "MUG-01" }, changes: { cartons: 90, unitsPerCarton: 12, quantityUnits: 1080 } }]);
    const e = evaluateBooking(r.draft, { todayUK: TODAY });
    expect(e.rules[2].status).toBe("pass");
    expect(e.rules[3].status).toBe("pass");
  });

  it('"I have booked the appointment" sets true and fixes R-08', () => {
    const r = apply(bk001({ deliveryAppointmentBooked: false }), [{ op: "set", field: "deliveryAppointmentBooked", value: true }]);
    expect(evaluateBooking(r.draft, { todayUK: TODAY }).rules[7].status).toBe("pass");
  });

  it("targets items by SKU without touching other lines; removeItem removes only that line", () => {
    const b = bk001({}, [item(), item({ sku: "TEA-02", description: "Teapot" })]);
    const r = apply(b, [{ op: "updateItem", target: { sku: "tea-02" }, changes: { quantityUnits: 50 } }]);
    expect(r.draft.items[0]).toEqual(b.items[0]);
    expect(r.draft.items[1].quantityUnits).toBe(50);
    const removed = apply(b, [{ op: "removeItem", target: { sku: "MUG-01" } }]);
    expect(removed.draft.items.map((i) => i.sku)).toEqual(["TEA-02"]);
  });

  it("unknown SKU with several lines is a warning, not a guess", () => {
    const b = bk001({}, [item(), item({ sku: "TEA-02" })]);
    const r = apply(b, [{ op: "updateItem", target: { sku: "XYZ" }, changes: { cartons: 1 } }]);
    expect(r.draft).toEqual(b);
    expect(r.warnings[0]).toMatch(/couldn't find/);
  });

  it("explicitly blank HS code / origin are kept as blanks so rules flag them", () => {
    const r = apply(bk001(), [{ op: "updateItem", target: { sku: "MUG-01" }, changes: { hsCode: "", countryOfOrigin: "" } }]);
    const e = evaluateBooking(r.draft, { todayUK: TODAY });
    expect(e.rules[0].status).toBe("fail");
    expect(e.rules[8].status).toBe("fail");
    expect(e.missingFields).toHaveLength(0);
  });

  it("normalises numbers, money and countries", () => {
    const r = apply(emptyDraft(), [
      { op: "set", field: "totalDeclaredValueGBP", value: "£5,400" },
      { op: "set", field: "totalGrossWeightKg", value: "620kg" },
      { op: "addItem", item: { sku: "A", hsCode: 691200, countryOfOrigin: "made in china" } },
    ]);
    expect(r.draft.totalDeclaredValueGBP).toBe(5400);
    expect(r.draft.totalGrossWeightKg).toBe(620);
    expect(r.draft.items[0].hsCode).toBe("691200");
    expect(r.draft.items[0].countryOfOrigin).toBe("China");
  });

  it("rejects impossible values with a warning", () => {
    const r = apply(bk001(), [
      { op: "set", field: "pallets", value: -2 },
      { op: "set", field: "pallets", value: 2.5 },
      { op: "updateItem", target: { sku: "MUG-01" }, changes: { quantityUnits: -5 } },
    ]);
    expect(r.draft.pallets).toBe(3);
    expect(r.draft.items[0].quantityUnits).toBe(1080);
    expect(r.warnings).toHaveLength(3);
  });

  it("selecting a carrier by name resolves to the route key; country change clears it", () => {
    const r = apply(bk001(), [{ op: "set", field: "selectedCarrierKey", value: "Carrier C" }]);
    expect(r.draft.selectedCarrierKey).toBe("GB-DE-C");
    const moved = apply(r.draft, [{ op: "set", field: "destinationCity", value: "Lyon" }]);
    expect(moved.draft.selectedCarrierKey).toBeNull();
    expect(moved.draft.destinationCountry).toBe("France");
  });
});

describe("Gemini output validation", () => {
  it("accepts a well-formed patch", () => {
    expect(ChatPatchSchema.safeParse({ operations: [{ op: "increment", field: "pallets", by: 1 }] }).success).toBe(true);
  });
  it("rejects malformed patches: unknown op/field, replacement booking, wrong types", () => {
    expect(ChatPatchSchema.safeParse({ operations: [{ op: "replace", booking: {} }] }).success).toBe(false);
    expect(ChatPatchSchema.safeParse({ operations: [{ op: "set", field: "status", value: "Ready" }] }).success).toBe(false);
    expect(ChatPatchSchema.safeParse({ operations: [{ op: "increment", field: "sellerName", by: 1 }] }).success).toBe(false);
    expect(ChatPatchSchema.safeParse({ operations: [{ op: "updateItem", target: {}, changes: {} }] }).success).toBe(false);
    expect(ChatPatchSchema.safeParse({ operations: [{ op: "addItem", item: { redCount: 0 } }] }).success).toBe(false);
    expect(ChatPatchSchema.safeParse("not json").success).toBe(false);
  });
});
