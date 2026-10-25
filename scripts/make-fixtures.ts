/**
 * Generates SYNTHETIC test workbooks in the template's structure (no real seller data).
 * Run: npm run fixtures
 */
import ExcelJS from "exceljs";
import { mkdirSync } from "node:fs";
import { BOOKING_HEADERS, ITEM_HEADERS } from "../lib/import/parse-xlsx";

type Row = (string | number | Date | null)[];
const OUT = "tests/fixtures";
mkdirSync(OUT, { recursive: true });

const EXAMPLE_B: Row = ["BK-001", "Northfield Goods", "Manchester", "United Kingdom", "Frankfurt", "Germany", "Warehouse", "05-11-2026", "Cheapest", 3, 90, 5400, "GBP", 620, "Yes"];
const EXAMPLE_I: Row = ["BK-001", "MUG-01", "Ceramic coffee mug, 350 ml", 691200, 1080, 5, 12, 90, 0.5, "United Kingdom"];

async function write(file: string, bookings: Row[], items: Row[], opts: { template?: boolean; headerRow1?: boolean; extraSheets?: boolean } = {}) {
  const wb = new ExcelJS.Workbook();
  const add = (name: string, headers: readonly string[], example: Row, rows: Row[]) => {
    const ws = wb.addWorksheet(name);
    if (!opts.headerRow1) ws.addRow([`${name} — one row per record. Row 3 is an example (grey); enter data from row 4.`]);
    ws.addRow([...headers]);
    if (opts.template) {
      const r = ws.addRow(example);
      r.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } }));
    }
    for (const row of rows) ws.addRow(row);
  };
  add("Bookings", BOOKING_HEADERS, EXAMPLE_B, bookings);
  add("Items", ITEM_HEADERS, EXAMPLE_I, items);
  if (opts.extraSheets) {
    const c = wb.addWorksheet("Carrier options");
    c.addRow(["FIXED - judges will use exactly this rate card. Do not edit."]);
    c.addRow(["Carrier", "Service", "Origin country", "Destination country", "Price per pallet"]);
    c.addRow(["Carrier A", "Road economy", "United Kingdom", "Germany", 1]); // must be ignored
  }
  await wb.xlsx.writeFile(`${OUT}/${file}`);
  console.log(`wrote ${OUT}/${file} (${bookings.length} bookings, ${items.length} items)`);
}

async function main() {
  // Clean: three bookings that pass all ten rules (ready dates in 2027 so R-10 stays green).
  await write(
    "clean.xlsx",
    [
      ["BK-101", "Harbour Ceramics Ltd", "Manchester", "United Kingdom", "Frankfurt", "Germany", "Warehouse", "15-01-2027", "Cheapest", 3, 90, 5400, "GBP", 620, "Yes"],
      ["BK-102", "Pennine Textiles", "Leeds", "United Kingdom", "Lyon", "France", "Business address", "20-01-2027", "Fastest", 2, 60, 4200, "GBP", 700, "No"],
      ["BK-103", "Midland Home Co", "Birmingham", "United Kingdom", "Rotterdam", "Netherlands", "Warehouse", "25-01-2027", "Balanced", 4, 110, 7550, "GBP", 1400, "Yes"],
    ],
    [
      ["BK-101", "MUG-01", "Ceramic coffee mug, 350 ml", 691200, 1080, 5, 12, 90, 0.5, "United Kingdom"],
      ["BK-102", "TSH-01", "Cotton t-shirt, navy", "610910", 600, 7, 10, 60, 0.25, "Turkey"],
      ["BK-103", "LMP-01", "Table lamp, oak base (bulb not included)", 940520, 400, 12.5, 8, 50, 1.5, "China"],
      ["BK-103", "CSH-02", "Linen cushion cover", 630499, 600, 4.25, 10, 60, 0.3, "India"],
    ],
    { template: true, extraSheets: true },
  );

  // Planted rule violations: one booking per rule, plus combined cases.
  await write(
    "planted-errors.xlsx",
    [
      ["BK-201", "R01 Short HS", "London", "United Kingdom", "Berlin", "Germany", "Business address", "15-01-2027", "Cheapest", 1, 10, 500, "GBP", 80, "No"],
      ["BK-202", "R02 Value", "London", "United Kingdom", "Berlin", "Germany", "Business address", "15-01-2027", "Cheapest", 3, 90, 4000, "GBP", 620, "No"],
      ["BK-203", "R03 Cartons", "Leeds", "United Kingdom", "Hamburg", "Germany", "Business address", "15-01-2027", "Cheapest", 3, 80, 5400, "GBP", 620, "No"],
      ["BK-204", "R04 Total cartons", "Leeds", "United Kingdom", "Hamburg", "Germany", "Business address", "15-01-2027", "Cheapest", 3, 100, 5400, "GBP", 620, "No"],
      ["BK-205", "R05 Heavy", "Birmingham", "United Kingdom", "Paris", "France", "Business address", "15-01-2027", "Cheapest", 1, 90, 5400, "GBP", 1600, "No"],
      ["BK-206", "R06 Hazard", "Birmingham", "United Kingdom", "Paris", "France", "Business address", "15-01-2027", "Cheapest", 1, 10, 150, "GBP", 60, "No"],
      ["BK-207", "R07 Light gross", "Manchester", "United Kingdom", "Amsterdam", "Netherlands", "Business address", "15-01-2027", "Cheapest", 3, 90, 5400, "GBP", 400, "No"],
      ["BK-208", "R08 No appointment", "Manchester", "United Kingdom", "Amsterdam", "Netherlands", "Warehouse", "15-01-2027", "Cheapest", 3, 90, 5400, "GBP", 620, "No"],
      ["BK-209", "R09 No origin", "London", "United Kingdom", "Rotterdam", "Netherlands", "Business address", "15-01-2027", "Cheapest", 3, 90, 5400, "GBP", 620, "No"],
      ["BK-210", "R10 Past date", "London", "United Kingdom", "Rotterdam", "Netherlands", "Business address", "01-09-2026", "Cheapest", 3, 90, 5400, "GBP", 620, "No"],
      ["BK-211", "Capacity B only", "Manchester", "United Kingdom", "Frankfurt", "Germany", "Business address", "15-01-2027", "Cheapest", 3, 90, 5400, "GBP", 1800, "No"],
      ["BK-212", "Combined red + amber", "Manchester", "United Kingdom", "Frankfurt", "Germany", "Business address", "15-01-2027", "Cheapest", 3, 80, 5400, "GBP", 620, "No"],
    ],
    [
      ["BK-201", "X-01", "Steel bottle opener", 6912, 100, 5, 10, 10, 0.05, "China"],
      ["BK-202", "MUG-01", "Ceramic coffee mug", 691200, 1080, 5, 12, 90, 0.5, "United Kingdom"],
      ["BK-203", "MUG-01", "Ceramic coffee mug", 691200, 1080, 5, 12, 80, 0.5, "United Kingdom"],
      ["BK-204", "MUG-01", "Ceramic coffee mug", 691200, 1080, 5, 12, 90, 0.5, "United Kingdom"],
      ["BK-205", "MUG-01", "Ceramic coffee mug", 691200, 1080, 5, 12, 90, 0.5, "United Kingdom"],
      ["BK-206", "PWR-02", "Portable power bank 10000mAh (lithium-ion)", 850760, 30, 5, 3, 10, 0.3, "China"],
      ["BK-207", "MUG-01", "Ceramic coffee mug", 691200, 1080, 5, 12, 90, 0.5, "United Kingdom"],
      ["BK-208", "MUG-01", "Ceramic coffee mug", 691200, 1080, 5, 12, 90, 0.5, "United Kingdom"],
      ["BK-209", "MUG-02", "Ceramic coffee mug", 691200, 1080, 5, 12, 90, 0.5, null],
      ["BK-210", "MUG-01", "Ceramic coffee mug", 691200, 1080, 5, 12, 90, 0.5, "United Kingdom"],
      ["BK-211", "MUG-01", "Ceramic coffee mug", 691200, 1080, 5, 12, 90, 0.5, "United Kingdom"],
      ["BK-212", "X-04", "Stoneware jug", 6912, 1080, 5, 12, 80, 0.5, null],
    ],
    { template: true },
  );

  // Structural/input issues mixed with valid records; headers on row 1, real Excel date cells,
  // text and numeric HS codes, many items per booking.
  await write(
    "input-issues.xlsx",
    [
      ["BK-301", "Valid Many Items", "London", "United Kingdom", "Paris", "France", "Warehouse", new Date(Date.UTC(2027, 1, 10)), "Most reliable", 2, 30, 600, "GBP", 300, "Yes"],
      ["BK-302", "Duplicate first", "London", "United Kingdom", "Paris", "France", "Business address", "10-02-2027", "Cheapest", 1, 10, 100, "GBP", 50, "No"],
      ["BK-302", "Duplicate second", "Leeds", "United Kingdom", "Lyon", "France", "Business address", "10-02-2027", "Cheapest", 1, 10, 100, "GBP", 50, "No"],
      ["BK-303", "Bad pair + bad date", "London", "United Kingdom", "Paris", "Germany", "Warehouse", "31-02-2027", "Cheapest", 1, 10, 100, "GBP", 50, "Yes"],
      ["BK-304", "No items", "London", "United Kingdom", "Berlin", "Germany", "Warehouse", "10-02-2027", "Cheapest", 1, 10, 100, "GBP", 50, "Yes"],
      ["BK-305", "Negative qty", "London", "United Kingdom", "Berlin", "Germany", "Business address", "10-02-2027", "Fastest", 1, 10, 100, "GBP", 50, "No"],
      ["BK-306", "", "Glasgow", "United Kingdom", "Berlin", "Germany", "Shop", "10-02-2027", "Soonest", 0, 10, 100, "EUR", 50, "Maybe"],
    ],
    [
      ["BK-301", "A-1", "Notebook A5", "482010", 100, 2, 10, 10, 0.2, "India"],
      ["BK-301", "A-2", "Notebook A4", 482010, 100, 2, 10, 10, 0.3, "India"],
      ["BK-301", "A-3", "Pen set", "960810", 100, 2, 10, 10, 0.1, "Vietnam"],
      ["BK-302", "D-1", "Socks", 611595, 100, 1, 10, 10, 0.1, "Turkey"],
      ["BK-303", "P-1", "Plates", 691200, 100, 1, 10, 10, 0.3, "China"],
      ["BK-305", "N-1", "Bowls", 691200, -5, 1, 10, 10, 0.3, "China"],
      ["BK-306", "Z-1", "Cups", 691200, 100, 1, 10, 10, 0.3, "China"],
      ["BK-999", "O-1", "Orphan item", 691200, 10, 1, 10, 1, 0.3, "China"],
    ],
    { headerRow1: true },
  );
}

main();
