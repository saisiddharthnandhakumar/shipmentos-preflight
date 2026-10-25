import { NextResponse, type NextRequest } from "next/server";
import { ConfirmBody } from "@/lib/server/api-schemas";
import { assertSameOrigin, assertUuid, enforceRateLimit, errorResponse, readJson, requireSession } from "@/lib/server/http";
import { runTurn } from "@/lib/server/turns";

export const runtime = "nodejs";

/** Save a complete, non-blocked booking as a ready-to-submit DRAFT. No carrier is contacted. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/bookings/[id]/confirm">) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id);
    const { db, session } = await requireSession(req);
    enforceRateLimit(req, session.id, "confirm", 30);
    const body = ConfirmBody.parse(await readJson(req));
    const r = await runTurn({ db, sessionId: session.id, bookingId: id, kind: "confirm", expectedRevision: body.expectedRevision, requestId: body.requestId });
    return NextResponse.json(r);
  } catch (err) {
    return errorResponse(err);
  }
}
