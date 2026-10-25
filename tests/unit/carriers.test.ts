import { describe, expect, it } from "vitest";
import { assessCarriers, balancedScores, rankEligible } from "@/lib/domain/carriers";
import { evaluateBooking } from "@/lib/domain/evaluate";
import { CARRIER_OPTIONS, type CarrierOption, type DestinationCountry, type SellerPriority } from "@/lib/domain/reference";
import type { CarrierCandidate } from "@/lib/domain/schemas";
import { bk001, TODAY } from "../helpers/builders";

const assess = (country: DestinationCountry, pallets: number, gross: number, priority: SellerPriority | null, selected: string | null = null) =>
  assessCarriers({ destinationCountry: country, pallets, totalGrossWeightKg: gross, sellerPriority: priority, selectedCarrierKey: selected }, CARRIER_OPTIONS);

describe("priorities × countries (light load, all eligible)", () => {
  const expected: Record<SellerPriority, string> = { Cheapest: "A", Fastest: "C", "Most reliable": "C", Balanced: "B" };
  const cost: Record<DestinationCountry, Record<string, number>> = {
    Germany: { A: 180, B: 220, C: 340 },
    France: { A: 170, B: 210, C: 330 },
    Netherlands: { A: 160, B: 200, C: 320 },
  };
  for (const country of ["Germany", "France", "Netherlands"] as const) {
    for (const p of Object.keys(expected) as SellerPriority[]) {
      it(`${country} / ${p}`, () => {
        const a = assess(country, 2, 300, p);
        const code = { Germany: "DE", France: "FR", Netherlands: "NL" }[country];
        expect(a.status).toBe("recommended");
        expect(a.recommendedKey).toBe(`GB-${code}-${expected[p]}`);
        const rec = a.candidates.find((c) => c.option.key === a.recommendedKey)!;
        expect(rec.totalCostGBP).toBe(2 * cost[country][expected[p]]);
      });
    }
  }
});

describe("weight filter before ranking", () => {
  it("1,800 kg / 3 pallets excludes A (500) and C (400); cheapest eligible is B £660", () => {
    const a = assess("Germany", 3, 1800, "Cheapest");
    expect(a.kgPerPallet).toBe(600);
    expect(a.candidates.filter((c) => c.eligible).map((c) => c.option.key)).toEqual(["GB-DE-B"]);
    expect(a.recommendedKey).toBe("GB-DE-B");
    expect(a.candidates.find((c) => c.option.key === "GB-DE-B")!.totalCostGBP).toBe(660);
    expect(a.explanation).toMatch(/Excluded: Carrier A Road economy \(600 kg\/pallet exceeds its 500 kg limit\)/);
  });

  it("exact boundary: 1,500 kg / 3 = 500 kg/pallet is eligible for Carrier A", () => {
    expect(assess("Germany", 3, 1500, "Cheapest").recommendedKey).toBe("GB-DE-A");
    expect(assess("Germany", 3, 1500.0003, "Cheapest").recommendedKey).toBe("GB-DE-B");
  });

  it("no eligible carrier: no recommendation, R-05 Red, suggested pallets = ceil(gross / 750)", () => {
    const a = assess("France", 1, 1600, "Cheapest");
    expect(a.status).toBe("no_eligible");
    expect(a.recommendedKey).toBeNull();
    expect(a.requiredPallets).toBe(3);
    const e = evaluateBooking(bk001({ destinationCountry: "France", destinationCity: "Paris", pallets: 1, totalGrossWeightKg: 1600 }), { todayUK: TODAY });
    const r05 = e.rules.find((r) => r.ruleId === "R-05")!;
    expect(r05.status).toBe("fail");
    expect(r05.findings[0].fix).toMatch(/at least 3/);
    expect(e.status).toBe("Blocked");
  });

  it("explicitly chosen too-light carrier fails R-05 and offers the eligible alternative", () => {
    const e = evaluateBooking(bk001({ totalGrossWeightKg: 1800, selectedCarrierKey: "GB-DE-A" }), { todayUK: TODAY });
    const r05 = e.rules.find((r) => r.ruleId === "R-05")!;
    expect(r05.status).toBe("fail");
    expect(r05.findings[0].message).toBe("1,800 kg ÷ 3 pallets = 600 kg/pallet. Carrier A limit is 500 kg.");
    expect(r05.findings[0].fix).toMatch(/Select Carrier B Road standard \(750 kg limit, £660\), or increase pallets to 4/);
  });

  it("missing priority leaves recommendation and R-05 not evaluable", () => {
    const a = assess("Germany", 3, 620, null);
    expect(a.status).toBe("not_evaluable");
    const e = evaluateBooking(bk001({ sellerPriority: null }), { todayUK: TODAY });
    expect(e.rules.find((r) => r.ruleId === "R-05")!.status).toBe("not_evaluable");
  });
});

describe("balanced score and tie-breaks", () => {
  it("scores A/B/C on the Germany card", () => {
    const a = assess("Germany", 3, 620, "Balanced");
    const s = balancedScores(a.candidates.filter((c) => c.eligible));
    // A: cost 1, speed 0, rel 0 → 0.40; B: cost 0.75, speed 0.667, rel 0.5 → 0.65; C: 0, 1, 1 → 0.60
    expect(s.get("GB-DE-A")!.score).toBe(0.4);
    expect(s.get("GB-DE-B")!.score).toBe(0.65);
    expect(s.get("GB-DE-C")!.score).toBe(0.6);
    expect(a.recommendedKey).toBe("GB-DE-B");
  });

  it("tied dimensions score 0.5 and ties break cheaper → faster → reliable → key", () => {
    const mk = (key: string, price: number, days: number, rate: number): CarrierCandidate => ({
      option: { key, carrier: key, service: "s", originCountry: "United Kingdom", destinationCountry: "Germany", pricePerPalletGBP: price, currency: "GBP", transitDays: days, onTimeRatePercent: rate, maxWeightPerPalletKg: 500 } as CarrierOption,
      totalCostGBP: price,
      eligible: true,
      exclusionReason: null,
      score: null,
      rank: null,
    });
    const s = balancedScores([mk("X", 100, 3, 90), mk("Y", 100, 3, 90)]);
    expect(s.get("X")!.score).toBe(0.5);
    expect(rankEligible([mk("Y", 100, 3, 90), mk("X", 100, 3, 90)], "Balanced").map((c) => c.option.key)).toEqual(["X", "Y"]);
    expect(rankEligible([mk("Y", 100, 2, 90), mk("X", 100, 3, 99)], "Cheapest").map((c) => c.option.key)).toEqual(["Y", "X"]);
    expect(rankEligible([mk("Y", 120, 2, 95), mk("X", 100, 2, 95)], "Fastest").map((c) => c.option.key)).toEqual(["X", "Y"]);
    expect(rankEligible([mk("Y", 120, 2, 95), mk("X", 100, 3, 95)], "Most reliable").map((c) => c.option.key)).toEqual(["X", "Y"]);
  });

  it("only one eligible option after weight filter (Balanced)", () => {
    const a = assess("Netherlands", 2, 1400, "Balanced");
    expect(a.recommendedKey).toBe("GB-NL-B");
    expect(a.explanation).toMatch(/only eligible service/);
  });
});
