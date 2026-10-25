import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { closeDb, getDb } from "@/lib/db/client";
import { commitBookingChange, createChatBooking } from "@/lib/db/repo";
import { evaluations } from "@/lib/db/schema";
import { evaluateBooking } from "@/lib/domain/evaluate";
import { ENGINE_VERSION, RATE_CARD_VERSION, RULEBOOK_VERSION } from "@/lib/domain/reference";
import { createSession } from "@/lib/server/session";
import { bk001 } from "../helpers/builders";

afterAll(closeDb);

describe("evaluation snapshots", () => {
  it("are stored per revision with engine/rate-card/rulebook versions and reflect recomputation", async () => {
    const db = getDb();
    const s = await createSession(db);
    const d0 = bk001();
    const e0 = evaluateBooking(d0, { todayUK: "2026-10-25" });
    const { id } = await createChatBooking(db, s.id, randomUUID(), d0, e0);
    const d1 = { ...d0, pallets: 4 };
    const e1 = evaluateBooking(d1, { todayUK: "2026-10-25" });
    await commitBookingChange(db, {
      sessionId: s.id, bookingId: id, expectedRevision: 0, requestId: "r1", kind: "edit", before: d0, after: d1,
      patch: [{ op: "increment", field: "pallets", by: 1 }], changedFields: ["pallets"], evaluation: e1, messages: [],
      buildResponse: (revision) => ({ revision }),
    });
    const rows = await db.select().from(evaluations).where(eq(evaluations.bookingId, id)).orderBy(asc(evaluations.bookingRevision));
    expect(rows.map((r) => [r.bookingRevision, r.engineVersion, r.rateCardVersion, r.rulebookVersion])).toEqual([
      [0, ENGINE_VERSION, RATE_CARD_VERSION, RULEBOOK_VERSION],
      [1, ENGINE_VERSION, RATE_CARD_VERSION, RULEBOOK_VERSION],
    ]);
    const cost = (r: (typeof rows)[number]) =>
      (r.carrierSnapshot as typeof e0.carrier).candidates.find((c) => c.option.key === "GB-DE-A")!.totalCostGBP;
    expect(cost(rows[0])).toBe(540);
    expect(cost(rows[1])).toBe(720);
    expect(rows[1].status).toBe("Ready to submit");
  });
});
