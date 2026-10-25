import ExcelJS from "exceljs";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { createChatBooking } from "@/lib/db/repo";
import { importBatches } from "@/lib/db/schema";
import { emptyDraft, type PatchOp } from "@/lib/domain/schemas";
import { BOOKING_HEADERS, ITEM_HEADERS } from "@/lib/import/parse-xlsx";
import { evaluateDraft } from "./booking-service";
import { importWorkbookBytes } from "./import-service";
import { ApiError } from "./http";
import { runTurn } from "./turns";

export const SAMPLE_FILENAME = "sample-bookings.xlsx";

type Row = (string | number | null)[];

const ukDate = (daysAhead: number) => {
  const d = new Date(Date.now() + daysAhead * 86_400_000);
  return `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}`;
};

/** Synthetic workbook: a spread of Ready, Needs attention and Blocked bookings. Ready dates are always in the future. */
async function sampleWorkbook(): Promise<Buffer> {
  const a = ukDate(21);
  const b = ukDate(28);
  const c = ukDate(35);
  const bookings: Row[] = [
    ["SMP-101", "Harbour Ceramics Ltd", "Manchester", "United Kingdom", "Frankfurt", "Germany", "Warehouse", a, "Cheapest", 3, 90, 5400, "GBP", 620, "Yes"],
    ["SMP-102", "Pennine Textiles", "Leeds", "United Kingdom", "Lyon", "France", "Business address", b, "Fastest", 2, 60, 4200, "GBP", 700, "No"],
    ["SMP-103", "Midland Home Co", "Birmingham", "United Kingdom", "Rotterdam", "Netherlands", "Warehouse", c, "Balanced", 4, 110, 7550, "GBP", 1400, "Yes"],
    ["SMP-104", "Thames Gifts", "London", "United Kingdom", "Amsterdam", "Netherlands", "Warehouse", a, "Cheapest", 3, 90, 5400, "GBP", 620, "No"],
    ["SMP-105", "Calder Outdoor", "Leeds", "United Kingdom", "Hamburg", "Germany", "Business address", b, "Cheapest", 3, 90, 5400, "GBP", 620, "No"],
    ["SMP-106", "Severn Electronics", "Birmingham", "United Kingdom", "Paris", "France", "Business address", c, "Cheapest", 1, 10, 150, "GBP", 60, "No"],
    ["SMP-107", "Mersey Kitchenware", "Manchester", "United Kingdom", "Berlin", "Germany", "Business address", a, "Balanced", 3, 80, 5400, "GBP", 620, "No"],
    ["SMP-108", "Albion Stationery", "London", "United Kingdom", "Rotterdam", "Netherlands", "Business address", b, "Cheapest", 3, 90, 5400, "GBP", 620, "No"],
  ];
  const items: Row[] = [
    ["SMP-101", "MUG-01", "Ceramic coffee mug, 350 ml", "691200", 1080, 5, 12, 90, 0.5, "United Kingdom"],
    ["SMP-102", "TSH-01", "Cotton t-shirt, navy", "610910", 600, 7, 10, 60, 0.25, "Turkey"],
    ["SMP-103", "LMP-01", "Table lamp, oak base", "940520", 400, 12.5, 8, 50, 1.5, "China"],
    ["SMP-103", "CSH-02", "Linen cushion cover", "630499", 600, 4.25, 10, 60, 0.3, "India"],
    ["SMP-104", "GFT-01", "Gift candle set", "340600", 1080, 5, 12, 90, 0.5, null],
    ["SMP-105", "TLS-01", "Garden trowel", "820110", 1080, 5, 12, 80, 0.5, "United Kingdom"],
    ["SMP-106", "PWR-02", "Portable power bank 10000mAh (lithium-ion)", "850760", 30, 5, 3, 10, 0.3, "China"],
    ["SMP-107", "PAN-01", "Stainless saucepan", "732393", 1080, 5, 12, 80, 0.5, "United Kingdom"],
    ["SMP-108", "NTB-01", "Notebook A5", "4820", 1080, 5, 12, 90, 0.5, "India"],
  ];
  const wb = new ExcelJS.Workbook();
  const add = (name: string, headers: readonly string[], rows: Row[]) => {
    const ws = wb.addWorksheet(name);
    ws.addRow([`${name}: one row per record.`]);
    ws.addRow([...headers]);
    for (const r of rows) ws.addRow(r);
  };
  add("Bookings", BOOKING_HEADERS, bookings);
  add("Items", ITEM_HEADERS, items);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Half-finished chat bookings, as someone mid-conversation would leave them. Created empty, then filled by a real edit so they show in lists. */
const SAMPLE_DRAFTS: { key: string; fields: Record<string, string | number> }[] = [
  { key: "sample-draft-1", fields: { sellerName: "Northern Textiles Ltd", originCity: "Leeds", destinationCity: "Lyon", destinationCountry: "France", sellerPriority: "Fastest", pallets: 2 } },
  { key: "sample-draft-2", fields: { originCity: "Birmingham", destinationCity: "Rotterdam", destinationCountry: "Netherlands", destinationType: "Warehouse", pallets: 4 } },
  { key: "sample-draft-3", fields: { sellerName: "Fenland Foods", originCity: "London", destinationCity: "Hamburg", destinationCountry: "Germany" } },
];

export async function loadSampleData(db: Db, sessionId: string) {
  const [existing] = await db
    .select({ id: importBatches.id })
    .from(importBatches)
    .where(and(eq(importBatches.sessionId, sessionId), eq(importBatches.originalFilenameSanitized, SAMPLE_FILENAME)))
    .limit(1);
  let imported = false;
  if (!existing) {
    await importWorkbookBytes(db, sessionId, await sampleWorkbook(), SAMPLE_FILENAME);
    imported = true;
  }
  let drafts = 0;
  for (const d of SAMPLE_DRAFTS) {
    const empty = emptyDraft();
    const r = await createChatBooking(db, sessionId, d.key, empty, await evaluateDraft(db, empty));
    try {
      await runTurn({
        db,
        sessionId,
        bookingId: r.id,
        kind: "edit",
        expectedRevision: 0,
        requestId: crypto.randomUUID(),
        operations: Object.entries(d.fields).map(([field, value]) => ({ op: "set", field, value }) as PatchOp),
      });
      drafts++;
    } catch (e) {
      // Already filled on an earlier call (revision moved on): nothing to do.
      if (!(e instanceof ApiError && e.code === "STALE_REVISION")) throw e;
    }
  }
  return { imported, drafts };
}
