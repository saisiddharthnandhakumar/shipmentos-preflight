import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, enforceRateLimit, errorResponse, requireSession } from "@/lib/server/http";
import { loadSampleData } from "@/lib/server/sample-data";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Fill this session with synthetic bookings so every screen can be seen with data. Safe to repeat. */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { db, session } = await requireSession(req);
    enforceRateLimit(req, session.id, "sample", 5);
    return NextResponse.json(await loadSampleData(db, session.id), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
