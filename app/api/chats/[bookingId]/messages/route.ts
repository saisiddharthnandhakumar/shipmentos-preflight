import { NextResponse, type NextRequest } from "next/server";
import { NotFoundError, listMessages } from "@/lib/db/repo";
import { pageLimit } from "@/lib/server/api-schemas";
import { ApiError, assertUuid, errorResponse, requireSession } from "@/lib/server/http";

export const runtime = "nodejs";

/** Ordered transcript page. `cursor` (from nextCursor) loads earlier messages. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/chats/[bookingId]/messages">) {
  try {
    const { bookingId } = await ctx.params;
    assertUuid(bookingId, "conversation");
    const { db, session } = await requireSession(req);
    const p = req.nextUrl.searchParams;
    const cursor = p.get("cursor");
    const before = cursor && /^\d{1,15}$/.test(cursor) ? Number(cursor) : null;
    try {
      return NextResponse.json(await listMessages(db, session.id, bookingId, { before, limit: pageLimit(p.get("limit"), 50, 200) }));
    } catch (e) {
      if (e instanceof NotFoundError) throw new ApiError(404, "NOT_FOUND", "That conversation was not found in this browser session.");
      throw e;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
