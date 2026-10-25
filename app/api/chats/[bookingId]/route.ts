import { NextResponse, type NextRequest } from "next/server";
import { deleteChat } from "@/lib/db/repo";
import { ApiError, assertSameOrigin, assertUuid, errorResponse, requireSession } from "@/lib/server/http";

export const runtime = "nodejs";

/** Permanently delete one owned chat thread and its booking, items, messages, revisions and evaluations. */
export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/chats/[bookingId]">) {
  try {
    assertSameOrigin(req);
    const { bookingId } = await ctx.params;
    assertUuid(bookingId, "conversation");
    const { db, session } = await requireSession(req);
    const ok = await deleteChat(db, session.id, bookingId);
    if (!ok) throw new ApiError(404, "NOT_FOUND", "That conversation was not found in this browser session.");
    return NextResponse.json({ deleted: true, bookingId });
  } catch (err) {
    return errorResponse(err);
  }
}
