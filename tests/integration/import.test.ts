import { afterAll, describe, expect, it } from "vitest";
import { POST as importPost } from "@/app/api/import/route";
import { GET as importGet } from "@/app/api/imports/[id]/route";
import { GET as bookingsGet } from "@/app/api/bookings/route";
import { GET as bookingGet } from "@/app/api/bookings/[id]/route";
import { GET as chatsGet } from "@/app/api/chats/route";
import { closeDb } from "@/lib/db/client";
import { json, req, newJar } from "../helpers/http";
import { newSession } from "../helpers/session";
import { upload, uploadReq } from "../helpers/upload";

afterAll(closeDb);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = <T extends string>(params: Record<string, string>) => ({ params: Promise.resolve(params) }) as any as T extends never ? never : any;

describe("POST /api/import", () => {
  it("imports the planted-error workbook, persists findings, and reopens after 'refresh'", async () => {
    const jar = await newSession();
    const { status, body } = await upload(jar, "planted-errors.xlsx");
    expect(status).toBe(201);
    expect(body.summary).toMatchObject({ total: 12, blocked: 7, needsAttention: 4, ready: 1 });
    expect(body.summary.skippedExampleRows).toHaveLength(2);
    expect(body.summary.ruleFailures).toMatchObject({ "R-01": 2, "R-03": 2, "R-05": 1, "R-06": 1, "R-09": 2, "R-10": 1 });

    // Re-open the stored batch with a fresh request (no re-upload).
    const again = await importGet(req(`/api/imports/${body.batchId}`, { jar }), ctx<"/api/imports/[id]">({ id: body.batchId }));
    const batch = await json(again);
    expect(batch.bookings).toHaveLength(12);
    const bk212 = batch.bookings.find((b: { externalBookingId: string }) => b.externalBookingId === "BK-212");
    expect([bk212.status, bk212.redCount, bk212.amberCount]).toEqual(["Blocked", 2, 1]);
    const detail = await json(await bookingGet(req(`/api/bookings/${bk212.id}`, { jar }), ctx<"/api/bookings/[id]">({ id: bk212.id })));
    expect(detail.evaluation.rules).toHaveLength(10);
    expect(detail.evaluation.rules[2].findings[0].message).toBe("SKU X-04 has 1,080 units but 12 × 80 = 960.");
    expect(detail.draft.items[0].sourceRow).toBe(15);
    expect(detail.booking.source).toBe("excel");
  });

  it("input issues are stored row-scoped; valid bookings in the same file still import", async () => {
    const jar = await newSession();
    const { body } = await upload(jar, "input-issues.xlsx");
    expect(body.summary.total).toBe(6);
    const batch = await json(await importGet(req(`/api/imports/${body.batchId}`, { jar }), ctx<"/api/imports/[id]">({ id: body.batchId })));
    const codes = batch.issues.map((i: { code: string }) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["DUPLICATE_BOOKING_ID", "ORPHAN_ITEM", "MALFORMED_DATE", "INVALID_LOCATION_PAIR", "NO_ITEMS", "INVALID_NUMBER"]));
    const orphan = batch.issues.find((i: { code: string }) => i.code === "ORPHAN_ITEM");
    expect(orphan).toMatchObject({ sheet: "Items", row: 9, bookingId: null });
    const ok = batch.bookings.find((b: { externalBookingId: string }) => b.externalBookingId === "BK-301");
    expect(ok.status).toBe("Ready to submit");
  });

  it("rejects non-xlsx uploads and cross-site posts", async () => {
    const jar = await newSession();
    const form = new FormData();
    form.append("file", new File([Buffer.from("hello")], "data.csv"));
    const bad = await importPost(req("/api/import", { method: "POST", jar, rawBody: form }));
    expect(bad.status).toBe(400);
    const r = uploadReq(jar, "clean.xlsx");
    r.headers.set("origin", "https://evil.example");
    expect((await importPost(r)).status).toBe(403);
    expect((await importPost(uploadReq(newJar(), "clean.xlsx"))).status).toBe(401);
  });

  it("imports are invisible to other sessions and excluded from Previous chats", async () => {
    const a = await newSession();
    const b = await newSession();
    const { body } = await upload(a, "clean.xlsx");
    expect((await importGet(req(`/api/imports/${body.batchId}`, { jar: b }), ctx<"/api/imports/[id]">({ id: body.batchId }))).status).toBe(404);
    const aList = await json(await bookingsGet(req("/api/bookings?source=excel", { jar: a })));
    expect(aList.items).toHaveLength(3);
    const someId = aList.items[0].id;
    expect((await bookingGet(req(`/api/bookings/${someId}`, { jar: b }), ctx<"/api/bookings/[id]">({ id: someId }))).status).toBe(404);
    expect((await json(await bookingsGet(req("/api/bookings", { jar: b })))).items).toEqual([]);
    expect((await json(await chatsGet(req("/api/chats", { jar: a })))).items).toEqual([]);
  });
});
