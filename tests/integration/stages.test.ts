import { afterAll, describe, expect, it } from "vitest";
import { GET as bookingsGet } from "@/app/api/bookings/route";
import { DELETE as bookingDelete, GET as bookingGet } from "@/app/api/bookings/[id]/route";
import { POST as confirmPost } from "@/app/api/bookings/[id]/confirm/route";
import { PUT as namePut } from "@/app/api/bookings/[id]/name/route";
import { GET as summaryGet } from "@/app/api/bookings/summary/route";
import { closeDb } from "@/lib/db/client";
import { addDays, todayUK } from "@/lib/domain/dates";
import { json, req, type Jar } from "../helpers/http";
import { newSession } from "../helpers/session";
import { upload } from "../helpers/upload";

afterAll(closeDb);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as any;
const summary = async (jar: Jar, qs = "") => json(await summaryGet(req(`/api/bookings/summary${qs}`, { jar })));
const list = async (jar: Jar, qs: string) => (await json(await bookingsGet(req(`/api/bookings?${qs}`, { jar })))).items as { id: string; externalBookingId: string | null; title: string; status: string; confirmed: boolean }[];

describe("stages: Drafts / Sync to ERP / Completed", () => {
  it("counts and lists split bookings by what they are, and sending to the ERP moves one to Completed", async () => {
    const jar = await newSession();
    await upload(jar, "planted-errors.xlsx"); // 7 Blocked, 4 Needs attention, 1 Ready
    expect(await summary(jar)).toEqual({ all: 12, completed: 0, sync: 5, draft: 7 });
    expect((await list(jar, "stage=draft&limit=50")).every((b) => b.status === "Blocked")).toBe(true);
    expect(await list(jar, "stage=draft&limit=50")).toHaveLength(7);
    expect(await list(jar, "stage=sync&limit=50")).toHaveLength(5);

    const target = (await list(jar, "stage=sync&limit=50"))[0];
    const snap = await json(await bookingGet(req(`/api/bookings/${target.id}`, { jar }), ctx(target.id)));
    const res = await confirmPost(req(`/api/bookings/${target.id}/confirm`, { method: "POST", jar, body: { expectedRevision: snap.booking.revision, requestId: `stage${Date.now()}abcd` } }), ctx(target.id));
    expect(res.status).toBe(200);
    expect(await summary(jar)).toEqual({ all: 12, completed: 1, sync: 4, draft: 7 });
    const done = await list(jar, "stage=completed&limit=50");
    expect(done.map((b) => b.id)).toEqual([target.id]);
    expect(done[0].confirmed).toBe(true);
    expect(await list(jar, "limit=50")).toHaveLength(12);
  });

  it("date range filters on the London day of last activity, for lists and counts alike", async () => {
    const jar = await newSession();
    await upload(jar, "clean.xlsx");
    const today = todayUK();
    expect((await summary(jar, `?from=${today}&to=${today}`)).all).toBe(3);
    expect((await summary(jar, `?from=${addDays(today, 1)}`)).all).toBe(0);
    expect((await summary(jar, `?to=${addDays(today, -1)}`)).all).toBe(0);
    expect(await list(jar, `from=${addDays(today, -7)}&to=${addDays(today, 7)}`)).toHaveLength(3);
    expect(await list(jar, `from=${addDays(today, 1)}`)).toHaveLength(0);
    // Malformed dates are ignored rather than trusted.
    expect((await summary(jar, "?from=nonsense")).all).toBe(3);
  });

  it("rename sets the Booking ID without a new revision; clearing restores it; delete removes only that booking", async () => {
    const jar = await newSession();
    const other = await newSession();
    await upload(jar, "clean.xlsx");
    const [first, second] = await list(jar, "limit=50");
    const before = await json(await bookingGet(req(`/api/bookings/${first.id}`, { jar }), ctx(first.id)));

    const put = (j: Jar, id: string, name: string | null) => namePut(req(`/api/bookings/${id}/name`, { method: "PUT", jar: j, body: { name } }), ctx(id));
    expect((await put(jar, first.id, "  Q4 mug order ")).status).toBe(200);
    const after = await json(await bookingGet(req(`/api/bookings/${first.id}`, { jar }), ctx(first.id)));
    expect(after.booking).toMatchObject({ externalBookingId: "Q4 mug order", revision: before.booking.revision });
    expect(after.draft.externalBookingId).toBe("Q4 mug order");
    expect(after.booking.title).toContain("Q4 mug order");
    expect((await put(jar, first.id, "")).status).toBe(200);
    expect((await json(await bookingGet(req(`/api/bookings/${first.id}`, { jar }), ctx(first.id)))).booking.externalBookingId).toBeNull();
    expect((await put(jar, first.id, "x".repeat(61))).status).toBe(400);
    expect((await put(other, first.id, "hijack")).status).toBe(404);

    const del = (j: Jar, id: string) => bookingDelete(req(`/api/bookings/${id}`, { method: "DELETE", jar: j }), ctx(id));
    expect((await del(other, first.id)).status).toBe(404);
    expect((await del(jar, first.id)).status).toBe(200);
    expect((await del(jar, first.id)).status).toBe(404);
    expect((await summary(jar)).all).toBe(2);
    expect((await list(jar, "limit=50")).map((b) => b.id)).toContain(second.id);
  });
});
