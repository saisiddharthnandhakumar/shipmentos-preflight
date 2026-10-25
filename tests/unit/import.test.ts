import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { evaluateBooking } from "@/lib/domain/evaluate";
import { BOOKING_HEADERS, ITEM_HEADERS, parseWorkbook, sanitizeFilename } from "@/lib/import/parse-xlsx";
import { uuid } from "../helpers/builders";

const TODAY = "2026-10-25";
const load = (f: string) => parseWorkbook(readFileSync(`tests/fixtures/${f}`), uuid);
const evalAll = async (f: string) => {
  const r = await load(f);
  return { r, out: new Map(r.bookings.map((b) => [b.draft.externalBookingId!, { b, e: evaluateBooking(b.draft, { todayUK: TODAY, inputIssues: b.issues }) }])) };
};
const failing = (e: ReturnType<typeof evaluateBooking>) => e.rules.filter((x) => x.status === "fail").map((x) => x.ruleId);

describe("template structure", () => {
  it("clean workbook: skips only the unchanged example row, ignores extra rate tabs, all Ready", async () => {
    const { r, out } = await evalAll("clean.xlsx");
    expect(r.stats.headerRows).toEqual({ Bookings: 2, Items: 2 });
    expect(r.stats.skippedExampleRows).toEqual([{ sheet: "Bookings", row: 3 }, { sheet: "Items", row: 3 }]);
    expect([...out.keys()]).toEqual(["BK-101", "BK-102", "BK-103"]);
    for (const { e } of out.values()) expect(e.status).toBe("Ready to submit");
    expect(out.get("BK-103")!.b.draft.items).toHaveLength(2);
    expect(out.get("BK-101")!.b.draft.items[0].hsCode).toBe("691200");
    expect(out.get("BK-101")!.b.draft.items[0].sourceRow).toBe(4);
    expect(out.get("BK-101")!.e.carrier.recommendedKey).toBe("GB-DE-A");
    expect(out.get("BK-102")!.e.carrier.recommendedKey).toBe("GB-FR-C");
    expect(out.get("BK-103")!.e.carrier.recommendedKey).toBe("GB-NL-B");
    expect(r.issues.filter((i) => i.severity !== "info")).toEqual([]);
  });

  it("a genuine BK-001 that differs from the example is imported, not dropped", async () => {
    const wb = new ExcelJS.Workbook();
    const b = wb.addWorksheet("Bookings");
    b.addRow(["title"]);
    b.addRow([...BOOKING_HEADERS]);
    b.addRow(["BK-001", "Northfield Goods", "Manchester", "United Kingdom", "Frankfurt", "Germany", "Warehouse", "05-11-2026", "Cheapest", 4, 90, 5400, "GBP", 620, "Yes"]);
    const i = wb.addWorksheet("Items");
    i.addRow(["title"]);
    i.addRow([...ITEM_HEADERS]);
    i.addRow(["BK-001", "MUG-01", "Ceramic coffee mug, 350 ml", 691200, 1080, 5, 12, 90, 0.5, "United Kingdom"]);
    const r = await parseWorkbook(await wb.xlsx.writeBuffer(), uuid);
    expect(r.stats.skippedExampleRows).toEqual([]);
    expect(r.bookings.map((x) => [x.draft.externalBookingId, x.draft.pallets, x.draft.items.length])).toEqual([["BK-001", 4, 1]]);
  });
});

describe("planted rule violations", () => {
  it("each planted booking fails exactly its rule with the right severity", async () => {
    const { out } = await evalAll("planted-errors.xlsx");
    const expectFail: Record<string, string[]> = {
      "BK-201": ["R-01"], "BK-202": ["R-02"], "BK-203": ["R-03"], "BK-204": ["R-04"], "BK-205": ["R-05"],
      "BK-206": ["R-06"], "BK-207": ["R-07"], "BK-208": ["R-08"], "BK-209": ["R-09"], "BK-210": ["R-10"], "BK-211": [], "BK-212": ["R-01", "R-03", "R-09"],
    };
    for (const [id, rules] of Object.entries(expectFail)) expect([id, failing(out.get(id)!.e)]).toEqual([id, rules]);
    expect(out.get("BK-207")!.e.status).toBe("Needs attention");
    expect(out.get("BK-212")!.e.status).toBe("Blocked");
    expect([out.get("BK-212")!.e.redCount, out.get("BK-212")!.e.amberCount]).toEqual([2, 1]);
    const r05 = out.get("BK-205")!.e;
    expect(r05.carrier.status).toBe("no_eligible");
    expect(r05.carrier.requiredPallets).toBe(3);
    const b211 = out.get("BK-211")!.e;
    expect(b211.carrier.recommendedKey).toBe("GB-DE-B");
    expect(b211.status).toBe("Ready to submit");
    expect(out.get("BK-202")!.e.rules[1].findings[0].message).toBe("Declared £4,000, item sum £5,400, £1,400 difference (25.93% of computed sum).");
    expect(out.get("BK-212")!.e.rules[0].findings[0].message).toBe("SKU X-04: HS code 6912 has only 4 digits.");
  });
});

describe("input issues are separate from rules and don't drop valid records", () => {
  it("headers on row 1, Excel date cells, duplicates, orphans, bad pairs, malformed dates, negatives", async () => {
    const { r, out } = await evalAll("input-issues.xlsx");
    expect(r.stats.headerRows).toEqual({ Bookings: 1, Items: 1 });
    expect([...out.keys()]).toEqual(["BK-301", "BK-302", "BK-303", "BK-304", "BK-305", "BK-306"]);
    const v = out.get("BK-301")!;
    expect(v.b.draft.readyToShipDate).toBe("2027-02-10");
    expect(v.b.draft.items.map((i) => i.hsCode)).toEqual(["482010", "482010", "960810"]);
    expect(v.e.status).toBe("Ready to submit");
    expect(v.b.issues).toEqual([]);

    const codes = (id: string) => out.get(id)!.b.issues.map((i) => i.code).sort();
    expect(codes("BK-302")).toEqual(["DUPLICATE_BOOKING_ID"]);
    expect(r.issues.some((i) => i.code === "DUPLICATE_BOOKING_ID" && i.row === 4)).toBe(true);
    expect(codes("BK-303")).toEqual(["INVALID_LOCATION_PAIR", "MALFORMED_DATE"]);
    expect(codes("BK-304")).toEqual(["NO_ITEMS"]);
    expect(codes("BK-305")).toEqual(["INVALID_NUMBER"]);
    expect(out.get("BK-305")!.b.issues[0].message).toBe("Quantity (units) must be at least 0 (got -5).");
    expect(codes("BK-306")).toEqual(["INVALID_NUMBER", "INVALID_VALUE", "INVALID_VALUE", "INVALID_VALUE", "INVALID_VALUE", "INVALID_VALUE", "MISSING_VALUE"]);
    for (const id of ["BK-302", "BK-303", "BK-304", "BK-305", "BK-306"]) expect(out.get(id)!.e.status).toBe("Blocked");
    // Input issues never masquerade as rule IDs
    for (const { b } of out.values()) for (const i of b.issues) expect(i.code).not.toMatch(/^R-\d/);
    const orphan = r.issues.find((i) => i.code === "ORPHAN_ITEM")!;
    expect(orphan).toMatchObject({ sheet: "Items", row: 9, rawValue: "BK-999" });
  });

  it("missing sheets / columns / garbage files are reported, not thrown", async () => {
    const wb = new ExcelJS.Workbook();
    const b = wb.addWorksheet("Bookings");
    b.addRow(BOOKING_HEADERS.filter((h) => h !== "Seller priority"));
    b.addRow(["BK-1", "S", "London", "United Kingdom", "Paris", "France", "Warehouse", "10-02-2027", 1, 1, 1, "GBP", 1, "Yes"]);
    const r = await parseWorkbook(await wb.xlsx.writeBuffer(), uuid);
    expect(r.issues.map((i) => i.code).sort()).toEqual(["MISSING_COLUMN", "MISSING_SHEET"]);
    expect(r.bookings).toHaveLength(1);
    const junk = await parseWorkbook(Buffer.from("not a zip"), uuid);
    expect(junk.issues[0].code).toBe("INVALID_FILE");
  });

  it("sanitises filenames", () => {
    expect(sanitizeFilename("../../etc/<script>bookings.xlsx")).toBe("_script_bookings.xlsx");
  });
});
