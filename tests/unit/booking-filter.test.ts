import { describe, expect, it } from "vitest";
import { BookingFilterSchema, filterChips, filterSummary, isEmptyFilter, matchesFilter, normaliseFilter, type FilterableBooking } from "@/lib/domain/booking-filter";

const b = (over: Partial<FilterableBooking> = {}): FilterableBooking => ({ status: "Blocked", sellerName: "Northfield Goods", originCity: "Manchester", destinationCity: "Frankfurt", destinationCountry: "Germany", ...over });

describe("matchesFilter", () => {
  it("an empty filter matches everything", () => {
    expect(matchesFilter(b(), 1, false, {})).toBe(true);
  });
  it("destination country, case-insensitively, and nothing else when it differs", () => {
    expect(matchesFilter(b(), 1, false, { destinationCountries: ["Germany"] })).toBe(true);
    expect(matchesFilter(b({ destinationCountry: "France" }), 1, false, { destinationCountries: ["Germany"] })).toBe(false);
    expect(matchesFilter(b({ originCity: "LEEDS" }), 1, false, { originCities: ["leeds"] })).toBe(true);
    expect(matchesFilter(b({ destinationCountry: null }), 1, false, { destinationCountries: ["Germany"] })).toBe(false);
  });
  it("row range is inclusive at both ends", () => {
    const f = { rowFrom: 1, rowTo: 7 };
    expect([0, 1, 7, 8].map((row) => matchesFilter(b(), row, false, f))).toEqual([false, true, true, false]);
  });
  it("combines criteria with AND, values within one list with OR", () => {
    const f = { destinationCountries: ["Germany", "France"] as ("Germany" | "France")[], statuses: ["Blocked" as const], rowTo: 5 };
    expect(matchesFilter(b({ destinationCountry: "France" }), 3, false, f)).toBe(true);
    expect(matchesFilter(b({ destinationCountry: "France", status: "Ready to submit" }), 3, false, f)).toBe(false);
    expect(matchesFilter(b(), 6, false, f)).toBe(false);
  });
  it("input-issue filter uses the issue flag", () => {
    expect(matchesFilter(b(), 1, false, { inputIssuesOnly: true })).toBe(false);
    expect(matchesFilter(b(), 1, true, { inputIssuesOnly: true })).toBe(true);
  });
});

describe("normaliseFilter / chips / summary", () => {
  it("drops empties and swaps an inverted row range", () => {
    expect(normaliseFilter({ destinationCountries: [], inputIssuesOnly: false, rowFrom: 9, rowTo: 2 })).toEqual({ rowFrom: 2, rowTo: 9 });
    expect(isEmptyFilter({ statuses: [], sellers: [] })).toBe(true);
  });
  it("each chip removes exactly its own criterion", () => {
    const f = normaliseFilter({ destinationCountries: ["Germany", "France"], rowFrom: 1, rowTo: 7 });
    const chips = filterChips(f);
    expect(chips.map((c) => c.label)).toEqual(["Rows 1–7", "To Germany", "To France"]);
    expect(chips[1].remove(f)).toEqual({ rowFrom: 1, rowTo: 7, destinationCountries: ["France"] });
    expect(chips[0].remove(f)).toEqual({ destinationCountries: ["Germany", "France"] });
  });
  it("summary counts come from the data", () => {
    expect(filterSummary(12, 12, {})).toBe("Showing all 12 bookings.");
    expect(filterSummary(5, 12, { rowTo: 5 })).toBe("Showing 5 of 12 bookings.");
    expect(filterSummary(0, 12, { rowTo: 5 })).toMatch(/^No bookings match \(0 of 12\)/);
  });
  it("the schema rejects countries we don't ship to", () => {
    expect(BookingFilterSchema.safeParse({ destinationCountries: ["Spain"] }).success).toBe(false);
  });
});
