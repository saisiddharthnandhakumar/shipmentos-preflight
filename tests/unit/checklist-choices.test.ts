import { describe, expect, it } from "vitest";
import { buildChecklist } from "@/lib/domain/checklist";
import { choicesFor } from "@/lib/domain/choices";
import { missingFields } from "@/lib/domain/missing";
import { applyPatch } from "@/lib/domain/patch";
import { emptyDraft } from "@/lib/domain/schemas";
import { bk001, item, TODAY, uuid } from "../helpers/builders";

const ctx = { todayUK: TODAY, newId: uuid };
const checklist = (d = emptyDraft()) => buildChecklist(d, missingFields(d));
const keys = (c: ReturnType<typeof checklist>) => c.groups.flatMap((g) => g.rows).map((r) => r.key);

describe("checklist", () => {
  it("starts empty, in asking order, with the route as the next question", () => {
    const c = checklist();
    expect(c).toMatchObject({ done: 0, total: 11, complete: false });
    expect(keys(c)).toEqual(["originCity", "destinationCity", "destinationType", "sellerName", "readyToShipDate", "sellerPriority", "items", "pallets", "totalGrossWeightKg", "cartons", "totalDeclaredValueGBP"]);
    expect(c.groups.flatMap((g) => g.rows).filter((r) => r.next).map((r) => r.key)).toEqual(["originCity", "destinationCity", "destinationType"]);
  });

  it("ticks details off as they arrive and moves 'next' on", () => {
    const { draft } = applyPatch(emptyDraft(), [
      { op: "set", field: "originCity", value: "Manchester" },
      { op: "set", field: "destinationCity", value: "Frankfurt" },
      { op: "set", field: "destinationType", value: "Warehouse" },
    ], ctx);
    const c = checklist(draft);
    const rows = Object.fromEntries(c.groups.flatMap((g) => g.rows).map((r) => [r.key, r]));
    expect([rows.originCity.done, rows.destinationCity.done, rows.destinationType.done, rows.sellerName.done]).toEqual([true, true, true, false]);
    expect(rows.sellerName.next).toBe(true);
    expect(rows.originCity.next).toBe(false);
    // A warehouse needs an appointment, so that row now exists and is open.
    expect(rows.deliveryAppointmentBooked).toMatchObject({ done: false });
  });

  it("adds a group of item rows per product and completes only when everything is in", () => {
    const withItem = emptyDraft();
    withItem.items = [item({ hsCode: null })];
    const c = checklist(withItem);
    const group = c.groups.find((g) => g.title === "MUG-01")!;
    expect(group.rows).toHaveLength(9);
    expect(group.rows.find((r) => r.label === "HS code")!.done).toBe(false);
    expect(c.groups.some((g) => g.rows.some((r) => r.key === "items"))).toBe(false);
    expect(checklist(bk001())).toMatchObject({ complete: true, done: 20, total: 20 });
  });
});

describe("tap-to-answer choices", () => {
  const groupsFor = (d: ReturnType<typeof emptyDraft>, today = TODAY) => choicesFor(d, missingFields(d), today);

  it("offers the route options first: four origin cities, seven destinations, two delivery types", () => {
    const g = groupsFor(emptyDraft());
    expect(g.map((x) => x.key)).toEqual(["originCity", "destinationCity", "destinationType"]);
    expect(g[0].options.map((o) => o.label)).toEqual(["London", "Manchester", "Birmingham", "Leeds"]);
    expect(g[1].options.map((o) => `${o.label}/${o.hint}`)).toEqual(["Berlin/Germany", "Frankfurt/Germany", "Hamburg/Germany", "Paris/France", "Lyon/France", "Amsterdam/Netherlands", "Rotterdam/Netherlands"]);
    expect(g[2].options.map((o) => o.label)).toEqual(["Warehouse", "Business address"]);
  });

  it("every option's operations apply cleanly and fill exactly that field", () => {
    let d = emptyDraft();
    for (const key of ["originCity", "destinationCity", "destinationType"]) {
      const o = groupsFor(d).find((x) => x.key === key)!.options[1];
      d = applyPatch(d, o.ops, ctx).draft;
    }
    expect(d).toMatchObject({ originCity: "Manchester", destinationCity: "Frankfurt", destinationCountry: "Germany", destinationType: "Business address" });
    // Next question: date + priority get options (seller name is free text).
    const next = groupsFor(d);
    expect(next.map((x) => x.key)).toEqual(["readyToShipDate", "sellerPriority"]);
    expect(next[0].options.map((o) => o.label)).toEqual(["Tomorrow", "In 3 days", "In a week", "In 2 weeks"]);
    const tomorrow = applyPatch(d, next[0].options[0].ops, ctx).draft;
    expect(tomorrow.readyToShipDate).toBe("2026-10-26");
    expect(applyPatch(d, next[1].options[1].ops, ctx).draft.sellerPriority).toBe("Fastest");
  });

  it("item questions: made-in countries and a way to say 'no HS code yet'", () => {
    const d = bk001({}, [item({ hsCode: null, countryOfOrigin: null })]);
    const g = groupsFor(d);
    const hs = g.find((x) => x.key.endsWith(":hsCode"))!;
    const made = g.find((x) => x.key.endsWith(":countryOfOrigin"))!;
    expect(made.options.map((o) => o.label)).toEqual(["United Kingdom", "China", "India", "Vietnam", "Turkey", "Germany", "Not sure"]);
    const after = applyPatch(d, [...hs.options[0].ops, ...made.options[1].ops], ctx).draft;
    expect(after.items[0]).toMatchObject({ hsCode: "", countryOfOrigin: "China" });
    expect(missingFields(after).map((m) => m.field)).not.toContain("hsCode");
  });

  it("no options once nothing choosable is being asked", () => {
    expect(groupsFor(bk001())).toEqual([]);
  });
});
