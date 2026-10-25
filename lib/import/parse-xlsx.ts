/**
 * Workbook → canonical bookings + items + input issues. Pure (no DB, no AI).
 *
 * Template facts (Case2_Shipment_Booking_Test_Data_Format.xlsx): row 1 is an instruction line,
 * row 2 holds the headers, row 3 is a grey example (BK-001 / MUG-01), data from row 4. We find the
 * header row by content, so files whose headers are on row 1 also work.
 */
import ExcelJS from "exceljs";
import { excelDateToISO, parseDDMMYYYY } from "../domain/dates";
import { missingFields } from "../domain/missing";
import { normalizeDestinationCountry, normalizeItemCountry, parseNumber } from "../domain/patch";
import {
  CURRENCY,
  DESTINATION_CITIES,
  DESTINATION_COUNTRIES,
  DESTINATION_TYPES,
  ITEM_ORIGIN_COUNTRIES,
  ORIGIN_CITIES,
  SELLER_PRIORITIES,
  TEMPLATE_EXAMPLE_BOOKING,
  TEMPLATE_EXAMPLE_ITEM,
  countryForDestinationCity,
} from "../domain/reference";
import { normalizeHsCode } from "../domain/rules";
import { emptyDraft, type DraftBooking, type DraftItem, type InputIssue } from "../domain/schemas";

export const BOOKING_HEADERS = [
  "Booking ID",
  "Seller name",
  "Origin city",
  "Origin country",
  "Destination city",
  "Destination country",
  "Destination type",
  "Ready to ship date",
  "Seller priority",
  "Pallets",
  "Cartons",
  "Total declared value",
  "Currency",
  "Total gross weight (kg)",
  "Delivery appointment booked",
] as const;

export const ITEM_HEADERS = [
  "Booking ID",
  "SKU",
  "Description",
  "HS code",
  "Quantity (units)",
  "Unit price",
  "Units per carton",
  "Cartons",
  "Unit weight (kg)",
  "Country of origin",
] as const;

export const IMPORT_LIMITS = { maxBytes: 4 * 1024 * 1024, maxBookingRows: 2000, maxItemRows: 10_000, maxItemsPerBooking: 200 };

type BookingHeader = (typeof BOOKING_HEADERS)[number];
type ItemHeader = (typeof ITEM_HEADERS)[number];

export type Issue = InputIssue & { externalBookingId?: string | null };

export type ParsedBooking = {
  draft: DraftBooking;
  sourceRow: number;
  raw: Record<string, string | null>;
  itemRaw: Map<string, Record<string, string | null>>;
  issues: Issue[];
};

export type ParseResult = {
  bookings: ParsedBooking[];
  /** Workbook/sheet-level issues and row issues that could not be attached to an imported booking. */
  issues: Issue[];
  stats: { bookingRows: number; itemRows: number; skippedExampleRows: { sheet: "Bookings" | "Items"; row: number }[]; headerRows: { Bookings: number | null; Items: number | null } };
};

type Cell = { text: string | null; number: number | null; date: Date | null; bool: boolean | null };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function cellValue(v: ExcelJS.CellValue): Cell {
  const out: Cell = { text: null, number: null, date: null, bool: null };
  if (v === null || v === undefined) return out;
  if (typeof v === "number") {
    out.number = v;
    out.text = Number.isInteger(v) ? String(v) : String(v);
    return out;
  }
  if (typeof v === "string") {
    const t = v.trim();
    out.text = t === "" ? null : t;
    return out;
  }
  if (typeof v === "boolean") {
    out.bool = v;
    out.text = v ? "TRUE" : "FALSE";
    return out;
  }
  if (v instanceof Date) {
    out.date = v;
    const iso = excelDateToISO(v);
    out.text = iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : null;
    return out;
  }
  if (typeof v === "object") {
    if ("richText" in v && Array.isArray(v.richText)) return cellValue(v.richText.map((r) => r.text).join(""));
    if ("formula" in v || "sharedFormula" in v) {
      const res = (v as ExcelJS.CellFormulaValue).result;
      return res === undefined || (typeof res === "object" && res !== null && "error" in res) ? out : cellValue(res as ExcelJS.CellValue);
    }
    if ("text" in v && typeof (v as { text: unknown }).text === "string") return cellValue((v as { text: string }).text);
    if ("error" in v) return out;
  }
  return out;
}

function findSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet | undefined {
  return wb.worksheets.find((ws) => norm(ws.name) === norm(name));
}

/** Locate the header row by content within the first 10 rows. */
function locateHeader(ws: ExcelJS.Worksheet, expected: readonly string[]): { row: number; columns: Map<string, number> } | null {
  const want = new Set(expected.map(norm));
  let best: { row: number; columns: Map<string, number>; hits: number } | null = null;
  const last = Math.min(ws.rowCount, 10);
  for (let r = 1; r <= last; r++) {
    const columns = new Map<string, number>();
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
      const t = cellValue(cell.value).text;
      if (t && want.has(norm(t)) && !columns.has(norm(t))) columns.set(norm(t), col);
    });
    if (columns.size >= Math.ceil(expected.length / 2) && (!best || columns.size > best.hits)) best = { row: r, columns, hits: columns.size };
  }
  return best ? { row: best.row, columns: best.columns } : null;
}

function rowCells<H extends string>(row: ExcelJS.Row, headers: readonly H[], columns: Map<string, number>): Record<H, Cell> {
  const out = {} as Record<H, Cell>;
  for (const h of headers) {
    const col = columns.get(norm(h));
    out[h] = col ? cellValue(row.getCell(col).value) : { text: null, number: null, date: null, bool: null };
  }
  return out;
}

const isBlankRow = (cells: Record<string, Cell>) => Object.values(cells).every((c) => c.text === null);

function rawOf(cells: Record<string, Cell>): Record<string, string | null> {
  return Object.fromEntries(Object.entries(cells).map(([k, c]) => [k, c.text]));
}

function matchesExample(cells: Record<string, Cell>, headers: readonly string[], example: readonly string[]): boolean {
  return headers.every((h, i) => {
    const c = cells[h];
    const expected = example[i];
    if (c.text === expected) return true;
    if (c.number !== null && parseNumber(expected) === c.number) return true;
    return false;
  });
}

function ciPick<T extends string>(list: readonly T[], text: string): T | null {
  return list.find((x) => norm(x) === norm(text)) ?? null;
}

export async function parseWorkbook(input: ArrayBuffer | Buffer, newId: () => string): Promise<ParseResult> {
  const issues: Issue[] = [];
  const result: ParseResult = {
    bookings: [],
    issues,
    stats: { bookingRows: 0, itemRows: 0, skippedExampleRows: [], headerRows: { Bookings: null, Items: null } },
  };
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(input as ArrayBuffer);
  } catch {
    issues.push({ code: "INVALID_FILE", severity: "error", sheet: "Workbook", message: "This file couldn't be read as an .xlsx workbook." });
    return result;
  }

  const bSheet = findSheet(wb, "Bookings");
  const iSheet = findSheet(wb, "Items");
  if (!bSheet) issues.push({ code: "MISSING_SHEET", severity: "error", sheet: "Workbook", message: 'No sheet named "Bookings" was found. Sheets present: ' + wb.worksheets.map((w) => w.name).join(", ") });
  if (!iSheet) issues.push({ code: "MISSING_SHEET", severity: "error", sheet: "Workbook", message: 'No sheet named "Items" was found, so item-level rules cannot be checked.' });
  if (!bSheet) return result;

  const bHeader = locateHeader(bSheet, BOOKING_HEADERS);
  if (!bHeader) {
    issues.push({ code: "MISSING_HEADERS", severity: "error", sheet: "Bookings", message: `Couldn't find the header row (expected columns: ${BOOKING_HEADERS.join(", ")}).` });
    return result;
  }
  result.stats.headerRows.Bookings = bHeader.row;
  const missingB = BOOKING_HEADERS.filter((h) => !bHeader.columns.has(norm(h)));
  for (const h of missingB)
    issues.push({ code: "MISSING_COLUMN", severity: "error", sheet: "Bookings", row: bHeader.row, column: h, message: `Column "${h}" is missing from the Bookings sheet.` });

  const iHeader = iSheet ? locateHeader(iSheet, ITEM_HEADERS) : null;
  if (iSheet && !iHeader) issues.push({ code: "MISSING_HEADERS", severity: "error", sheet: "Items", message: `Couldn't find the Items header row (expected columns: ${ITEM_HEADERS.join(", ")}).` });
  if (iHeader) {
    result.stats.headerRows.Items = iHeader.row;
    for (const h of ITEM_HEADERS.filter((h) => !iHeader.columns.has(norm(h))))
      issues.push({ code: "MISSING_COLUMN", severity: "error", sheet: "Items", row: iHeader.row, column: h, message: `Column "${h}" is missing from the Items sheet.` });
  }

  // ── Bookings ────────────────────────────────────────────────────────────────
  const byId = new Map<string, ParsedBooking>();
  let firstDataRowSeen = false;
  for (let r = bHeader.row + 1; r <= bSheet.rowCount; r++) {
    const cells = rowCells(bSheet.getRow(r), BOOKING_HEADERS, bHeader.columns);
    if (isBlankRow(cells)) continue;
    if (!firstDataRowSeen) {
      firstDataRowSeen = true;
      if (matchesExample(cells, BOOKING_HEADERS, TEMPLATE_EXAMPLE_BOOKING)) {
        result.stats.skippedExampleRows.push({ sheet: "Bookings", row: r });
        issues.push({ code: "TEMPLATE_EXAMPLE_SKIPPED", severity: "info", sheet: "Bookings", row: r, message: `Row ${r} is the template's unchanged example (BK-001, Northfield Goods) and was not imported.` });
        continue;
      }
    }
    result.stats.bookingRows++;
    if (result.stats.bookingRows > IMPORT_LIMITS.maxBookingRows) {
      issues.push({ code: "TOO_MANY_ROWS", severity: "error", sheet: "Bookings", row: r, message: `Only the first ${IMPORT_LIMITS.maxBookingRows} bookings are imported.` });
      break;
    }
    const parsed = parseBookingRow(cells, r);
    const id = parsed.draft.externalBookingId;
    if (id && byId.has(id)) {
      const first = byId.get(id)!;
      issues.push({ code: "DUPLICATE_BOOKING_ID", severity: "error", sheet: "Bookings", row: r, column: "Booking ID", rawValue: id, externalBookingId: null, message: `Booking ID ${id} on row ${r} duplicates row ${first.sourceRow}; this row was not imported.` });
      if (!first.issues.some((i) => i.code === "DUPLICATE_BOOKING_ID"))
        first.issues.push({ code: "DUPLICATE_BOOKING_ID", severity: "error", sheet: "Bookings", row: first.sourceRow, column: "Booking ID", rawValue: id, externalBookingId: id, message: `Booking ID ${id} also appears on row ${r}. Booking IDs must be unique; items for ${id} can't be attributed reliably.` });
      continue;
    }
    if (id) byId.set(id, parsed);
    result.bookings.push(parsed);
  }

  // ── Items ───────────────────────────────────────────────────────────────────
  if (iSheet && iHeader) {
    let firstItemSeen = false;
    for (let r = iHeader.row + 1; r <= iSheet.rowCount; r++) {
      const cells = rowCells(iSheet.getRow(r), ITEM_HEADERS, iHeader.columns);
      if (isBlankRow(cells)) continue;
      if (!firstItemSeen) {
        firstItemSeen = true;
        const exampleBookingSkipped = result.stats.skippedExampleRows.some((s) => s.sheet === "Bookings");
        if (matchesExample(cells, ITEM_HEADERS, TEMPLATE_EXAMPLE_ITEM) && (exampleBookingSkipped || !byId.has("BK-001"))) {
          result.stats.skippedExampleRows.push({ sheet: "Items", row: r });
          issues.push({ code: "TEMPLATE_EXAMPLE_SKIPPED", severity: "info", sheet: "Items", row: r, message: `Row ${r} is the template's unchanged example item (MUG-01) and was not imported.` });
          continue;
        }
      }
      result.stats.itemRows++;
      if (result.stats.itemRows > IMPORT_LIMITS.maxItemRows) {
        issues.push({ code: "TOO_MANY_ROWS", severity: "error", sheet: "Items", row: r, message: `Only the first ${IMPORT_LIMITS.maxItemRows} item rows are imported.` });
        break;
      }
      const bookingId = cells["Booking ID"].text;
      const owner = bookingId ? byId.get(bookingId) : undefined;
      if (!owner) {
        issues.push({
          code: bookingId ? "ORPHAN_ITEM" : "MISSING_VALUE",
          severity: "error",
          sheet: "Items",
          row: r,
          column: "Booking ID",
          rawValue: bookingId ?? undefined,
          message: bookingId
            ? `Item row ${r} (SKU ${cells.SKU.text ?? "?"}) refers to Booking ID ${bookingId}, which isn't on the Bookings sheet.`
            : `Item row ${r} has no Booking ID, so it can't be attached to a booking.`,
        });
        continue;
      }
      if (owner.draft.items.length >= IMPORT_LIMITS.maxItemsPerBooking) {
        owner.issues.push({ code: "TOO_MANY_ITEMS", severity: "error", sheet: "Items", row: r, externalBookingId: bookingId, message: `Booking ${bookingId} has more than ${IMPORT_LIMITS.maxItemsPerBooking} items; extra rows were ignored.` });
        continue;
      }
      const item = parseItemRow(cells, r, newId(), bookingId!, owner.issues);
      if (item.sku && owner.draft.items.some((i) => i.sku === item.sku))
        owner.issues.push({ code: "DUPLICATE_SKU", severity: "warning", sheet: "Items", row: r, column: "SKU", rawValue: item.sku, externalBookingId: bookingId, message: `SKU ${item.sku} appears more than once in ${bookingId}; each row is checked separately.` });
      owner.draft.items.push(item);
      owner.itemRaw.set(item.itemId, rawOf(cells));
    }
  }

  // ── Per-booking completeness ───────────────────────────────────────────────
  for (const b of result.bookings) {
    const ext = b.draft.externalBookingId;
    if (!b.draft.items.length && iSheet && iHeader)
      b.issues.push({ code: "NO_ITEMS", severity: "error", sheet: "Items", externalBookingId: ext, message: `Booking ${ext ?? `on row ${b.sourceRow}`} has no item rows on the Items sheet, so item rules can't be checked.` });
    for (const m of missingFields(b.draft)) {
      // Values that failed validation already have a specific issue; blanks get MISSING_VALUE.
      if (m.key === "items") continue;
      const already = b.issues.some((i) => i.code !== "MISSING_VALUE" && fieldMatchesIssue(m.field, i.column));
      if (already) continue;
      const item = m.itemId ? b.draft.items.find((i) => i.itemId === m.itemId) : null;
      b.issues.push({
        code: "MISSING_VALUE",
        severity: "error",
        sheet: item ? "Items" : "Bookings",
        row: item?.sourceRow ?? b.sourceRow,
        column: columnForField(m.field, Boolean(item)),
        externalBookingId: ext,
        message: `Required value missing: ${columnForField(m.field, Boolean(item))}${item ? ` for SKU ${item.sku ?? "?"}` : ""} (row ${item?.sourceRow ?? b.sourceRow}).`,
      });
    }
    for (const i of b.issues) i.externalBookingId = ext;
  }
  return result;
}

const FIELD_COLUMN: Record<string, BookingHeader> = {
  sellerName: "Seller name",
  originCity: "Origin city",
  destinationCity: "Destination city",
  destinationCountry: "Destination country",
  destinationType: "Destination type",
  readyToShipDate: "Ready to ship date",
  sellerPriority: "Seller priority",
  pallets: "Pallets",
  cartons: "Cartons",
  totalDeclaredValueGBP: "Total declared value",
  totalGrossWeightKg: "Total gross weight (kg)",
  deliveryAppointmentBooked: "Delivery appointment booked",
};
const ITEM_FIELD_COLUMN: Record<string, ItemHeader> = {
  sku: "SKU",
  description: "Description",
  hsCode: "HS code",
  quantityUnits: "Quantity (units)",
  unitPriceGBP: "Unit price",
  unitsPerCarton: "Units per carton",
  cartons: "Cartons",
  unitWeightKg: "Unit weight (kg)",
  countryOfOrigin: "Country of origin",
};

function columnForField(field: string, isItem: boolean): string {
  return (isItem ? ITEM_FIELD_COLUMN[field] : FIELD_COLUMN[field]) ?? field;
}
function fieldMatchesIssue(field: string, column: string | undefined): boolean {
  if (!column) return false;
  return FIELD_COLUMN[field] === column || ITEM_FIELD_COLUMN[field] === column || (field === "destinationCity" && column === "Destination country");
}

function parseBookingRow(c: Record<BookingHeader, Cell>, row: number): ParsedBooking {
  const issues: Issue[] = [];
  const d: DraftBooking = emptyDraft();
  const bad = (column: BookingHeader, code: string, message: string) =>
    issues.push({ code, severity: "error", sheet: "Bookings", row, column, rawValue: c[column].text ?? undefined, message });

  d.externalBookingId = c["Booking ID"].text?.slice(0, 64) ?? null;
  if (!d.externalBookingId) bad("Booking ID", "MISSING_VALUE", `Required value missing: Booking ID (row ${row}).`);
  d.sellerName = c["Seller name"].text?.slice(0, 200) ?? null;

  const originCity = c["Origin city"].text;
  if (originCity) {
    const v = ciPick(ORIGIN_CITIES, originCity);
    if (v) d.originCity = v;
    else bad("Origin city", "INVALID_VALUE", `Origin city "${originCity}" isn't allowed (${ORIGIN_CITIES.join(", ")}).`);
  }
  const originCountry = c["Origin country"].text;
  if (originCountry && normalizeItemCountry(originCountry) !== "United Kingdom")
    bad("Origin country", "INVALID_VALUE", `Origin country must be United Kingdom (got "${originCountry}").`);
  else if (!originCountry) bad("Origin country", "MISSING_VALUE", `Required value missing: Origin country (row ${row}).`);

  const destCountryText = c["Destination country"].text;
  if (destCountryText) {
    const v = normalizeDestinationCountry(destCountryText);
    if (v) d.destinationCountry = v;
    else bad("Destination country", "INVALID_VALUE", `Destination country "${destCountryText}" isn't supported (${DESTINATION_COUNTRIES.join(", ")}).`);
  }
  const destCity = c["Destination city"].text;
  if (destCity) {
    const all = DESTINATION_COUNTRIES.flatMap((k) => DESTINATION_CITIES[k]);
    const v = ciPick(all, destCity);
    if (!v) bad("Destination city", "INVALID_VALUE", `Destination city "${destCity}" isn't allowed (${all.join(", ")}).`);
    else {
      d.destinationCity = v;
      const cityCountry = countryForDestinationCity(v);
      if (d.destinationCountry && cityCountry !== d.destinationCountry)
        bad("Destination country", "INVALID_LOCATION_PAIR", `${v} is in ${cityCountry}, not ${d.destinationCountry}. Fix the destination city or country.`);
      if (!d.destinationCountry && !destCountryText) d.destinationCountry = cityCountry;
    }
  }
  const type = c["Destination type"].text;
  if (type) {
    const v = ciPick(DESTINATION_TYPES, type);
    if (v) d.destinationType = v;
    else bad("Destination type", "INVALID_VALUE", `Destination type must be Warehouse or Business address (got "${type}").`);
  }
  const date = c["Ready to ship date"];
  if (date.date) d.readyToShipDate = excelDateToISO(date.date);
  else if (date.number !== null && date.number > 20000 && date.number < 80000 && Number.isInteger(date.number)) {
    // Unformatted Excel serial date (days since 1899-12-30).
    d.readyToShipDate = excelDateToISO(new Date(Date.UTC(1899, 11, 30) + date.number * 86_400_000));
  } else if (date.text) {
    const iso = parseDDMMYYYY(date.text);
    if (iso) d.readyToShipDate = iso;
    else bad("Ready to ship date", "MALFORMED_DATE", `Ready to ship date "${date.text}" isn't a valid DD-MM-YYYY date.`);
  }
  const prio = c["Seller priority"].text;
  if (prio) {
    const v = ciPick(SELLER_PRIORITIES, prio);
    if (v) d.sellerPriority = v;
    else bad("Seller priority", "INVALID_VALUE", `Seller priority must be ${SELLER_PRIORITIES.join(", ")} (got "${prio}").`);
  }
  d.pallets = intCell(c.Pallets, "Pallets", 1, bad);
  d.cartons = intCell(c.Cartons, "Cartons", 0, bad);
  d.totalDeclaredValueGBP = decCell(c["Total declared value"], "Total declared value", bad);
  const currency = c.Currency.text;
  if (currency && currency.toUpperCase() !== CURRENCY) bad("Currency", "INVALID_VALUE", `Currency must be GBP (got "${currency}").`);
  else if (!currency) bad("Currency", "MISSING_VALUE", `Required value missing: Currency (row ${row}).`);
  d.totalGrossWeightKg = decCell(c["Total gross weight (kg)"], "Total gross weight (kg)", bad);
  const appt = c["Delivery appointment booked"];
  if (appt.bool !== null) d.deliveryAppointmentBooked = appt.bool;
  else if (appt.text) {
    const t = norm(appt.text);
    if (t === "yes" || t === "y" || t === "true") d.deliveryAppointmentBooked = true;
    else if (t === "no" || t === "n" || t === "false") d.deliveryAppointmentBooked = false;
    else bad("Delivery appointment booked", "INVALID_VALUE", `Delivery appointment booked must be Yes or No (got "${appt.text}").`);
  } else if (d.destinationType !== "Warehouse") {
    // Required by the template; only consequential for warehouses (R-08).
    issues.push({ code: "MISSING_VALUE", severity: d.destinationType ? "warning" : "error", sheet: "Bookings", row, column: "Delivery appointment booked", message: `Delivery appointment booked is blank (row ${row}).` });
  }
  return { draft: d, sourceRow: row, raw: rawOf(c), itemRaw: new Map(), issues };
}

function intCell(cell: Cell, column: string, min: number, bad: (c: never, code: string, m: string) => void): number | null {
  if (cell.text === null) return null;
  const n = cell.number ?? parseNumber(cell.text);
  if (n === null) {
    bad(column as never, "INVALID_NUMBER", `${column} "${cell.text}" isn't a number.`);
    return null;
  }
  if (!Number.isInteger(n)) {
    bad(column as never, "INVALID_NUMBER", `${column} must be a whole number (got ${cell.text}).`);
    return null;
  }
  if (n < min) {
    bad(column as never, "INVALID_NUMBER", `${column} must be at least ${min} (got ${cell.text}).`);
    return null;
  }
  return n;
}

function decCell(cell: Cell, column: string, bad: (c: never, code: string, m: string) => void): number | null {
  if (cell.text === null) return null;
  const n = cell.number ?? parseNumber(cell.text);
  if (n === null) {
    bad(column as never, "INVALID_NUMBER", `${column} "${cell.text}" isn't a number.`);
    return null;
  }
  if (n < 0) {
    bad(column as never, "INVALID_NUMBER", `${column} can't be negative (got ${cell.text}).`);
    return null;
  }
  return Math.round(n * 10_000) / 10_000;
}

function parseItemRow(c: Record<ItemHeader, Cell>, row: number, itemId: string, bookingId: string, issues: Issue[]): DraftItem {
  const bad = (column: ItemHeader, code: string, message: string) =>
    issues.push({ code, severity: "error", sheet: "Items", row, column, rawValue: c[column].text ?? undefined, externalBookingId: bookingId, message });
  const hs = c["HS code"];
  let hsCode: string;
  if (hs.number !== null) hsCode = Number.isInteger(hs.number) ? String(hs.number) : String(hs.number);
  else hsCode = hs.text ? normalizeHsCode(hs.text) : ""; // blank HS code is allowed by the template → R-01 flags it
  const country = c["Country of origin"].text;
  let countryOfOrigin = "";
  if (country) {
    countryOfOrigin = normalizeItemCountry(country);
    if (!(ITEM_ORIGIN_COUNTRIES as readonly string[]).includes(countryOfOrigin))
      issues.push({ code: "UNEXPECTED_VALUE", severity: "warning", sheet: "Items", row, column: "Country of origin", rawValue: country, externalBookingId: bookingId, message: `Country of origin "${country}" isn't in the template's allowed list; it was kept as written.` });
  }
  return {
    itemId,
    sku: c.SKU.text?.slice(0, 200) ?? null,
    description: c.Description.text?.slice(0, 200) ?? null,
    hsCode,
    quantityUnits: intCell(c["Quantity (units)"], "Quantity (units)", 0, bad as never),
    unitPriceGBP: decCell(c["Unit price"], "Unit price", bad as never),
    unitsPerCarton: intCell(c["Units per carton"], "Units per carton", 1, bad as never),
    cartons: intCell(c.Cartons, "Cartons", 0, bad as never),
    unitWeightKg: decCell(c["Unit weight (kg)"], "Unit weight (kg)", bad as never),
    countryOfOrigin,
    sourceRow: row,
  };
}

/** Strip paths/control characters; keep a short, safe display name. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "upload.xlsx";
  const cleaned = base.replace(/[^\w.\- ()]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
  return cleaned || "upload.xlsx";
}
