import { describe, expect, it } from "vitest";
import { evaluateBooking } from "@/lib/domain/evaluate";
import { ruleR01, ruleR02, ruleR03, ruleR04, ruleR06, ruleR07, ruleR08, ruleR09 } from "@/lib/domain/rules";
import { bk001, item, TODAY } from "../helpers/builders";

describe("R-01 HS code", () => {
  it("passes 6+ digits, fails short/blank/non-digit, treats null as unknown", () => {
    expect(ruleR01(bk001()).status).toBe("pass");
    expect(ruleR01(bk001({}, [item({ hsCode: "6912.00" })])).status).toBe("pass");
    const short = ruleR01(bk001({}, [item({ sku: "X-04", hsCode: "6912" })]));
    expect(short.status).toBe("fail");
    expect(short.findings[0].message).toBe("SKU X-04: HS code 6912 has only 4 digits.");
    expect(ruleR01(bk001({}, [item({ hsCode: "" })])).findings[0].actual).toBe("blank");
    expect(ruleR01(bk001({}, [item({ hsCode: "69A200" })])).status).toBe("fail");
    expect(ruleR01(bk001({}, [item({ hsCode: null })])).status).toBe("not_evaluable");
  });
});

describe("R-02 declared value", () => {
  it("reports the exact difference and percentage", () => {
    const r = ruleR02(bk001({ totalDeclaredValueGBP: 4000 }));
    expect(r.status).toBe("fail");
    expect(r.findings[0].message).toBe("Declared £4,000, item sum £5,400, £1,400 difference (25.93% of computed sum).");
  });
  it("exactly 1% passes, 1% + 1p fails (both directions)", () => {
    expect(ruleR02(bk001({ totalDeclaredValueGBP: 5454 })).status).toBe("pass");
    expect(ruleR02(bk001({ totalDeclaredValueGBP: 5346 })).status).toBe("pass");
    expect(ruleR02(bk001({ totalDeclaredValueGBP: 5454.01 })).status).toBe("fail");
    expect(ruleR02(bk001({ totalDeclaredValueGBP: 5345.99 })).status).toBe("fail");
  });
  it("handles fractional prices exactly and a zero item sum", () => {
    // 3 × £0.10 = £0.30 exactly (no float drift)
    expect(ruleR02(bk001({ totalDeclaredValueGBP: 0.3 }, [item({ quantityUnits: 3, unitPriceGBP: 0.1 })])).status).toBe("pass");
    expect(ruleR02(bk001({ totalDeclaredValueGBP: 0 }, [item({ unitPriceGBP: 0 })])).status).toBe("pass");
    expect(ruleR02(bk001({ totalDeclaredValueGBP: 1 }, [item({ unitPriceGBP: 0 })])).status).toBe("fail");
  });
  it("sums across multiple items", () => {
    const b = bk001({ totalDeclaredValueGBP: 5400 + 200 * 2.5 }, [item(), item({ sku: "B-2", quantityUnits: 200, unitPriceGBP: 2.5, unitsPerCarton: 20, cartons: 10 })]);
    expect(ruleR02(b).status).toBe("pass");
  });
});

describe("R-03 carton quantity", () => {
  it("matches the required example wording", () => {
    const r = ruleR03(bk001({}, [item({ cartons: 80 })]));
    expect(r.status).toBe("fail");
    expect(r.findings[0].message).toBe("SKU MUG-01 has 1,080 units but 12 × 80 = 960.");
    expect(r.findings[0].fix).toBe("Update cartons to 90 or quantity to 960, after checking physical stock.");
  });
  it("handles a non-divisible quantity and flags each failing item", () => {
    const r = ruleR03(bk001({}, [item({ quantityUnits: 1085 }), item({ sku: "B", cartons: 1 })]));
    expect(r.findings).toHaveLength(2);
    expect(r.findings[0].fix).toMatch(/not a whole number/);
  });
});

describe("R-04 total cartons", () => {
  it("compares booking cartons to item sum", () => {
    expect(ruleR04(bk001()).status).toBe("pass");
    const r = ruleR04(bk001({ cartons: 100 }));
    expect(r.findings[0].message).toBe("Booking says 100 cartons, item rows sum to 90 (difference 10).");
  });
});

describe("R-06 prohibited goods", () => {
  it("reports item and matched phrase", () => {
    const r = ruleR06(bk001({}, [item({ sku: "PWR-02", description: "Portable power bank with Li-ion cells" })]));
    expect(r.status).toBe("fail");
    expect(r.findings[0].message).toMatch(/SKU PWR-02/);
    expect(r.findings[0].message).toMatch(/power bank/);
  });
  it("does not flag battery-free products", () => {
    expect(ruleR06(bk001({}, [item({ description: "Battery-free kitchen timer" })])).status).toBe("pass");
  });
});

describe("R-07 gross weight", () => {
  it("gross below product weight is Amber", () => {
    const r = ruleR07(bk001({ totalGrossWeightKg: 400 }));
    expect(r.severity).toBe("Amber");
    expect(r.findings[0].message).toBe("Gross 400 kg below product weight 540 kg.");
  });
  it("equality passes", () => {
    expect(ruleR07(bk001({ totalGrossWeightKg: 540 })).status).toBe("pass");
  });
});

describe("R-08 / R-09 / R-10", () => {
  it("R-08 warehouse needs appointment", () => {
    expect(ruleR08(bk001({ deliveryAppointmentBooked: false })).status).toBe("fail");
    expect(ruleR08(bk001({ destinationType: "Business address", deliveryAppointmentBooked: false })).status).toBe("pass");
  });
  it("R-09 blank country fails, unknown is not evaluable", () => {
    const r = ruleR09(bk001({}, [item({ sku: "MUG-02", countryOfOrigin: "" })]));
    expect(r.findings[0].message).toBe("SKU MUG-02 is missing its country of origin.");
    expect(ruleR09(bk001({}, [item({ countryOfOrigin: null })])).status).toBe("not_evaluable");
  });
  it("R-10 today passes, yesterday fails", () => {
    const pass = evaluateBooking(bk001({ readyToShipDate: TODAY }), { todayUK: TODAY });
    expect(pass.rules[9].status).toBe("pass");
    const fail = evaluateBooking(bk001({ readyToShipDate: "2026-10-24" }), { todayUK: TODAY });
    expect(fail.rules[9].status).toBe("fail");
    expect(fail.rules[9].findings[0].message).toBe("Ready date 24-10-2026 is in the past (today is 25-10-2026, UK time).");
  });
});
