import { NextResponse, type NextRequest } from "next/server";
import { createChatBooking, listBookings } from "@/lib/db/repo";
import { isISODate, isTab } from "@/lib/domain/stage";
import { emptyDraft } from "@/lib/domain/schemas";
import { CreateBookingBody, pageLimit } from "@/lib/server/api-schemas";
import { evaluateDraft } from "@/lib/server/booking-service";
import { assertSameOrigin, enforceRateLimit, errorResponse, readJson, requireSession } from "@/lib/server/http";

export const runtime = "nodejs";

/** All bookings (chat + Excel) owned by this session, newest activity first. */
export async function GET(req: NextRequest) {
  try {
    const { db, session } = await requireSession(req);
    const p = req.nextUrl.searchParams;
    const source = p.get("source");
    const result = await listBookings(db, session.id, {
      cursor: p.get("cursor"),
      limit: pageLimit(p.get("limit"), 30, 100),
      source: source === "chat" || source === "excel" ? source : null,
      status: ["Draft", "Blocked", "Needs attention", "Ready to submit"].includes(p.get("status") ?? "") ? p.get("status") : null,
      q: p.get("q")?.slice(0, 80) || null,
      stage: isTab(p.get("stage")) && p.get("stage") !== "all" ? (p.get("stage") as "draft" | "sync" | "completed") : null,
      from: isISODate(p.get("from")) ? p.get("from") : null,
      to: isISODate(p.get("to")) ? p.get("to") : null,
    });
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

/** Start a new, independent chat-backed booking. Idempotent per clientKey. */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { db, session } = await requireSession(req);
    enforceRateLimit(req, session.id, "create-booking", 30);
    const body = CreateBookingBody.parse(await readJson(req));
    const draft = emptyDraft();
    const evaluation = await evaluateDraft(db, draft);
    const r = await createChatBooking(db, session.id, body.clientKey, draft, evaluation);
    return NextResponse.json({ bookingId: r.id, created: r.created, revision: 0 }, { status: r.created ? 201 : 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
