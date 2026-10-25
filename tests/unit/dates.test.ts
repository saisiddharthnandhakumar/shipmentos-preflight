import { describe, expect, it } from "vitest";
import { excelDateToISO, parseChatDate, parseDDMMYYYY, todayUK } from "@/lib/domain/dates";

describe("UK-local today", () => {
  it("uses Europe/London, not UTC or the machine timezone", () => {
    // 23:30 UTC on 30 Jun = 00:30 BST 1 Jul in London
    expect(todayUK(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
    // In winter (GMT) London equals UTC
    expect(todayUK(new Date("2026-12-31T23:30:00Z"))).toBe("2026-12-31");
    // 25 Oct 2026 is the BST→GMT switch day; 00:30 UTC is 01:30 BST
    expect(todayUK(new Date("2026-10-25T00:30:00Z"))).toBe("2026-10-25");
  });
});

describe("strict DD-MM-YYYY", () => {
  it("parses the template format and rejects impossible dates", () => {
    expect(parseDDMMYYYY("05-11-2026")).toBe("2026-11-05");
    expect(parseDDMMYYYY("31-02-2026")).toBeNull();
    expect(parseDDMMYYYY("2026-11-05")).toBeNull();
    expect(parseDDMMYYYY("5/11/26")).toBeNull();
  });
  it("converts Excel date cells", () => {
    expect(excelDateToISO(new Date(Date.UTC(2026, 10, 5)))).toBe("2026-11-05");
  });
});

describe("chat date wording", () => {
  const today = "2026-10-25";
  it("5 Nov → next occurrence with the year visibly assumed", () => {
    expect(parseChatDate("5 Nov", today)).toEqual({ ok: true, iso: "2026-11-05", note: "year_assumed" });
    expect(parseChatDate("November 5th", today)).toEqual({ ok: true, iso: "2026-11-05", note: "year_assumed" });
    expect(parseChatDate("05/11", today)).toEqual({ ok: true, iso: "2026-11-05", note: "year_assumed" });
  });
  it("explicit years are exact", () => {
    expect(parseChatDate("05-11-2026", today)).toEqual({ ok: true, iso: "2026-11-05", note: null });
    expect(parseChatDate("5 November 2027", today)).toEqual({ ok: true, iso: "2027-11-05", note: null });
  });
  it("a recently passed year-less date stays this year and asks to confirm", () => {
    expect(parseChatDate("20 Oct", today)).toEqual({ ok: true, iso: "2026-10-20", note: "confirm_year" });
  });
  it("a long-past year-less date rolls to next year (year-end)", () => {
    expect(parseChatDate("3 Jan", "2026-12-30")).toEqual({ ok: true, iso: "2027-01-03", note: "year_assumed" });
    expect(parseChatDate("10 March", today)).toEqual({ ok: true, iso: "2027-03-10", note: "year_assumed" });
  });
  it("relative words", () => {
    expect(parseChatDate("tomorrow", today)).toEqual({ ok: true, iso: "2026-10-26", note: null });
    expect(parseChatDate("next Friday", today)).toEqual({ ok: true, iso: "2026-10-30", note: null });
  });
  it("rejects nonsense and impossible dates", () => {
    expect(parseChatDate("soonish", today).ok).toBe(false);
    expect(parseChatDate("31 Feb", today).ok).toBe(false);
  });
});
