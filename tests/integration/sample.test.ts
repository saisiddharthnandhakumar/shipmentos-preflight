import { afterAll, afterEach, describe, expect, it } from "vitest";
import { POST as samplePost } from "@/app/api/sample/route";
import { GET as bookingsGet } from "@/app/api/bookings/route";
import { closeDb } from "@/lib/db/client";
import { resetRateLimits } from "@/lib/server/rate-limit";
import { json, req } from "../helpers/http";
import { newSession } from "../helpers/session";

afterAll(async () => {
  await closeDb();
});
afterEach(() => resetRateLimits());

describe("sample data", { timeout: 120_000 }, () => {
  it("fills a session with every status, and repeating it adds nothing", async () => {
    const jar = await newSession();
    const first = await samplePost(req("/api/sample", { method: "POST", jar }));
    expect(first.status).toBe(201);
    expect(await json(first)).toEqual({ imported: true, drafts: 3 });

    const count = async (status: string) => (await json(await bookingsGet(req(`/api/bookings?limit=100&status=${encodeURIComponent(status)}`, { jar })))).items.length as number;
    const before = [await count("Draft"), await count("Blocked"), await count("Needs attention"), await count("Ready to submit")];
    expect(before[0]).toBe(3);
    expect(before[1]).toBeGreaterThan(0);
    expect(before[2]).toBeGreaterThan(0);
    expect(before[3]).toBeGreaterThan(0);
    expect(before[1] + before[2] + before[3]).toBe(8);

    const second = await samplePost(req("/api/sample", { method: "POST", jar }));
    expect(await json(second)).toEqual({ imported: false, drafts: 0 });
    expect([await count("Draft"), await count("Blocked"), await count("Needs attention"), await count("Ready to submit")]).toEqual(before);
  });
});
