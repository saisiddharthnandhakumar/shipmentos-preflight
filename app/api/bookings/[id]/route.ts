import { NextResponse, type NextRequest } from "next/server";
import { deleteBooking } from "@/lib/db/repo";
import { EditBody } from "@/lib/server/api-schemas";
import { bookingSnapshot } from "@/lib/server/booking-service";
import { ApiError, assertSameOrigin, assertUuid, enforceRateLimit, errorResponse, readJson, requireSession } from "@/lib/server/http";
import { runTurn } from "@/lib/server/turns";

export const runtime = "nodejs";

/** Canonical booking, items, current evaluation and revision history (owner only). */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/bookings/[id]">) {
  try {
    const { id } = await ctx.params;
    assertUuid(id);
    const { db, session } = await requireSession(req);
    const snap = await bookingSnapshot(db, session.id, id);
    if (!snap) throw new ApiError(404, "NOT_FOUND", "That booking was not found in this browser session.");
    return NextResponse.json(snap);
  } catch (err) {
    return errorResponse(err);
  }
}

/** Direct human edit through the same version-safe, idempotent write path as chat. */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/bookings/[id]">) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { db, session } = await requireSession(req);
    enforceRateLimit(req, session.id, "edit", 60);
    const body = EditBody.parse(await readJson(req));
    const r = await runTurn({ db, sessionId: session.id, bookingId: id, kind: "edit", expectedRevision: body.expectedRevision, requestId: body.requestId, operations: body.operations });
    return NextResponse.json(r);
  } catch (err) {
    return errorResponse(err);
  }
}

/** Permanently delete one owned booking (chat or Excel) with its messages, revisions and evaluations. */
export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/bookings/[id]">) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { db, session } = await requireSession(req);
    if (!(await deleteBooking(db, session.id, id))) throw new ApiError(404, "NOT_FOUND", "That booking was not found in this browser session.");
    return NextResponse.json({ deleted: true, bookingId: id });
  } catch (err) {
    return errorResponse(err);
  }
}
