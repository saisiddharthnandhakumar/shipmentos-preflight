import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { renameBooking } from "@/lib/db/repo";
import { ApiError, assertSameOrigin, assertUuid, enforceRateLimit, errorResponse, readJson, requireSession } from "@/lib/server/http";

export const runtime = "nodejs";

const Body = z.object({ name: z.string().trim().max(60).nullable() });

/** Rename a booking (its Booking ID). An empty name goes back to the generated reference. */
export async function PUT(req: NextRequest, ctx: RouteContext<"/api/bookings/[id]/name">) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { db, session } = await requireSession(req);
    enforceRateLimit(req, session.id, "rename", 60);
    const { name } = Body.parse(await readJson(req));
    if (!(await renameBooking(db, session.id, id, name || null))) throw new ApiError(404, "NOT_FOUND", "That booking was not found in this browser session.");
    return NextResponse.json({ bookingId: id, name: name || null });
  } catch (err) {
    return errorResponse(err);
  }
}
