import ExcelJS from "exceljs";
import { afterAll, describe, expect, it } from "vitest";
import { POST as bookingsPost } from "@/app/api/bookings/route";
import { POST as importPost } from "@/app/api/chats/[bookingId]/import/route";
import { setExtractorForTests } from "@/lib/ai/extract";
import { closeDb } from "@/lib/db/client";
import { json, req } from "../helpers/http";
import { newSession } from "../helpers/session";

afterAll(() => {
  setExtractorForTests(null);
  return closeDb();
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = (bookingId: string) => ({ params: Promise.resolve({ bookingId }) }) as any;

/** A workbook that doesn't follow the Bookings/Items template at all. */
async function offTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Shipment info");
  ws.addRows([
    ["Shipper", "Northfield Ceramics"],
    ["From", "Manchester"],
    ["To", "Frankfurt (warehouse)"],
    ["Pallets", 3],
    [],
    ["Product", "Qty", "Price each (GBP)"],
    ["Ceramic mug", 1200, 5],
  ]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function run() {
  const jar = await newSession();
  const id = (await json(await bookingsPost(req("/api/bookings", { method: "POST", jar, body: { clientKey: `ai${Math.random().toString(36).slice(2)}abcd` } })))).bookingId as string;
  const form = new FormData();
  form.append("file", new File([new Uint8Array(await offTemplate())], "mine.xlsx"));
  form.append("expectedRevision", "0");
  form.append("requestId", `rq${Math.random().toString(36).slice(2)}abcd`);
  return json(await importPost(req(`/api/chats/${id}/import`, { method: "POST", jar, rawBody: form }), ctx(id)));
}

describe("import fallback when a workbook is not the template", () => {
  it("has the AI extract the booking and the chat reports what is missing", async () => {
    let seen = "";
    setExtractorForTests(async ({ message }) => {
      seen = message;
      return {
        operations: [
          { op: "set", field: "sellerName", value: "Northfield Ceramics" },
          { op: "set", field: "originCity", value: "Manchester" },
          { op: "set", field: "pallets", value: 3 },
          { op: "addItem", item: { description: "Ceramic mug", quantityUnits: 1200, unitPriceGBP: 5 } },
        ],
      };
    });
    const r = await run();
    expect(seen).toContain("Northfield Ceramics");
    expect(seen).toContain("Ceramic mug");
    expect(r.kind).toBe("booking");
    expect(r.snapshot.draft.sellerName).toBe("Northfield Ceramics");
    expect(r.snapshot.draft.items).toHaveLength(1);
    const reply = r.messages.find((m: { role: string }) => m.role === "assistant").content as string;
    expect(reply).toContain("Found:");
    expect(reply).toContain("Still missing:");
  });

  it("still errors clearly when the AI finds nothing", async () => {
    setExtractorForTests(async () => ({ operations: [] }));
    const r = await run();
    expect(r.error?.code ?? r.code).toBe("NO_BOOKINGS");
  });
});
