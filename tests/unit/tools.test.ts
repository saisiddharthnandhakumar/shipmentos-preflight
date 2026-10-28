import { describe, expect, it } from "vitest";
import { calculate } from "@/lib/domain/calculator";
import { checkHs, suggestHs } from "@/lib/domain/hs";
import { convertAmount } from "@/components/tools/currency-converter";

describe("shipping calculator", () => {
  it("matches the engine: 3 pallets to Germany, 620 kg, cheapest → Carrier A", () => {
    const r = calculate({ destination: "Germany", pallets: 3, grossWeightKg: 620, priority: "Cheapest", lines: [] });
    expect(r.carrier.kgPerPallet).toBeCloseTo(206.67, 2);
    expect(r.carrier.recommendedKey).toBe("GB-DE-A");
    expect(r.carrier.candidates.find((c) => c.option.key === "GB-DE-A")!.totalCostGBP).toBe(540);
  });
  it("excludes services over their kg/pallet limit", () => {
    const r = calculate({ destination: "France", pallets: 1, grossWeightKg: 600, priority: "Fastest", lines: [] });
    expect(r.carrier.candidates.filter((c) => c.eligible).map((c) => c.option.key)).toEqual(["GB-FR-B"]);
  });
  it("derives value, cartons and weight from items, and falls back to item weight", () => {
    const r = calculate({
      destination: "Germany", pallets: 2, grossWeightKg: null, priority: "Cheapest",
      lines: [{ quantity: 1080, unitPrice: 5, unitsPerCarton: 12, cartons: 90, unitWeightKg: 0.5 }, { quantity: 100, unitPrice: 2, unitsPerCarton: 10, cartons: 9, unitWeightKg: 1 }],
    });
    expect(r.itemsValue).toBe(5600);
    expect(r.lines[1].cartonsMatch).toBe(false);
    expect(r.lines[1].cartonsNeeded).toBe(10);
    expect(r.totalCartons).toBe(99);
    expect(r.minGrossWeightKg).toBe(640);
    expect(r.weightIsEstimate).toBe(true);
  });
});

describe("HS code check", () => {
  it("accepts the right code and flags a wrong one with a suggestion", () => {
    expect(checkHs("Ceramic coffee mug, 350 ml", "691200").kind).toBe("ok");
    const v = checkHs("Ceramic coffee mug, 350 ml", "610910");
    expect(v.kind).toBe("mismatch");
    if (v.kind === "mismatch") expect(v.suggestions[0].code).toBe("691200");
  });
  it("stays quiet for products it doesn't know and for missing data", () => {
    expect(checkHs("Quantum flux widget", "123456").kind).toBe("unknown");
    expect(checkHs("Ceramic mug", "").kind).toBe("unknown");
    expect(suggestHs("Notebook A5")[0].code).toBe("482010");
  });
  it("does not confuse ball-point pens with balls", () => {
    expect(suggestHs("Ball-point pen")[0].code).toBe("960810");
  });
});

describe("currency", () => {
  it("converts through GBP in both directions", () => {
    const rates = { GBP: 1, EUR: 1.2, USD: 1.25 };
    expect(convertAmount(100, "GBP", "EUR", rates)).toBeCloseTo(120);
    expect(convertAmount(120, "EUR", "GBP", rates)).toBeCloseTo(100);
    expect(convertAmount(120, "EUR", "USD", rates)).toBeCloseTo(125);
    expect(convertAmount(1, "GBP", "XXX", rates)).toBeNull();
  });
});

import { issueResolvedByDraft } from "@/lib/import/parse-xlsx";
import { emptyDraft } from "@/lib/domain/schemas";

describe("import issues resolved by edits", () => {
  it("drops a missing-value issue once the field is filled, keeps structural ones", () => {
    const d = emptyDraft();
    const seller = { code: "MISSING_VALUE", sheet: "Bookings" as const, row: 4, column: "Seller name" };
    expect(issueResolvedByDraft(seller, d)).toBe(false);
    expect(issueResolvedByDraft(seller, { ...d, sellerName: "Pennine Textiles" })).toBe(true);
    expect(issueResolvedByDraft({ code: "DUPLICATE_BOOKING_ID", sheet: "Bookings", row: 4, column: "Booking ID" }, { ...d, externalBookingId: "BK-1" })).toBe(false);
  });
});
