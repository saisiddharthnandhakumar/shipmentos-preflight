import { describe, expect, it } from "vitest";
import { evaluateBooking } from "@/lib/domain/evaluate";
import { emptyDraft } from "@/lib/domain/schemas";
import { bk001, item, TODAY } from "../helpers/builders";

describe("BK-001 template fixture", () => {
  it("passes all ten rules and recommends Carrier A at £540", () => {
    const e = evaluateBooking(bk001(), { todayUK: TODAY });
    expect(e.rules.map((r) => r.ruleId)).toEqual(["R-01", "R-02", "R-03", "R-04", "R-05", "R-06", "R-07", "R-08", "R-09", "R-10"]);
    expect(e.rules.every((r) => r.status === "pass")).toBe(true);
    expect(e.status).toBe("Ready to submit");
    expect(e.carrier.recommendedKey).toBe("GB-DE-A");
    const a = e.carrier.candidates.find((c) => c.option.key === "GB-DE-A")!;
    expect(a.totalCostGBP).toBe(540);
    expect(a.option.transitDays).toBe(5);
    expect(e.carrier.kgPerPallet).toBe(206.67);
    expect(e.timeline).toEqual({ proposedCollectionDate: "2026-11-05", indicativeDeliveryDate: "2026-11-10" });
  });

  it("is valid only while the injected UK date is on/before 5 Nov 2026", () => {
    expect(evaluateBooking(bk001(), { todayUK: "2026-11-05" }).rules[9].status).toBe("pass");
    const after = evaluateBooking(bk001(), { todayUK: "2026-11-06" });
    expect(after.rules[9].status).toBe("fail");
    expect(after.status).toBe("Needs attention");
  });

  it("recomputes cost and kg/pallet when a pallet is added (3 → 4)", () => {
    const e = evaluateBooking(bk001({ pallets: 4 }), { todayUK: TODAY });
    expect(e.carrier.candidates.find((c) => c.option.key === "GB-DE-A")!.totalCostGBP).toBe(720);
    expect(e.carrier.kgPerPallet).toBe(155);
  });
});

describe("status logic", () => {
  it("Draft when chat details are missing; rules without inputs are not_evaluable (never pass)", () => {
    const e = evaluateBooking({ ...emptyDraft(), pallets: 3, originCity: "Manchester" }, { todayUK: TODAY });
    expect(e.status).toBe("Draft");
    for (const r of e.rules) expect(r.status).toBe("not_evaluable");
    expect(e.missingFields.map((m) => m.key)).toContain("sellerName");
    expect(e.missingFields.map((m) => m.key)).not.toContain("pallets");
  });

  it("Blocked on any Red", () => {
    const e = evaluateBooking(bk001({}, [item({ cartons: 80 })]), { todayUK: TODAY });
    expect(e.status).toBe("Blocked");
    expect(e.redCount).toBe(2); // R-03 and R-04
  });

  it("Needs attention on Amber only", () => {
    const e = evaluateBooking(bk001({ deliveryAppointmentBooked: false }), { todayUK: TODAY });
    expect(e.status).toBe("Needs attention");
    expect(e.amberCount).toBe(1);
  });

  it("Blocked when there are input errors even if rules pass", () => {
    const e = evaluateBooking(bk001(), { todayUK: TODAY, inputIssues: [{ code: "DUPLICATE_BOOKING_ID", severity: "error", message: "dup" }] });
    expect(e.status).toBe("Blocked");
  });

  it("prohibited goods keep a tentative carrier but stay Blocked", () => {
    const e = evaluateBooking(bk001({}, [item({ description: "Power bank 10000mAh" })]), { todayUK: TODAY });
    expect(e.status).toBe("Blocked");
    expect(e.carrier.recommendedKey).toBe("GB-DE-A");
    expect(e.nextSteps.join(" ")).toMatch(/tentative/);
  });

  it("warehouse appointment is not required for business addresses", () => {
    const e = evaluateBooking(bk001({ destinationType: "Business address", deliveryAppointmentBooked: null }), { todayUK: TODAY });
    expect(e.missingFields).toHaveLength(0);
    expect(e.status).toBe("Ready to submit");
  });
});
