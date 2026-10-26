import { NextResponse, type NextRequest } from "next/server";
import { stageCounts } from "@/lib/db/repo";
import { isISODate } from "@/lib/domain/stage";
import { errorResponse, requireSession } from "@/lib/server/http";

export const runtime = "nodejs";

/** Counts for All / Completed / Sync to ERP / Drafts, optionally within an inclusive date range (last activity, London time). */
export async function GET(req: NextRequest) {
  try {
    const { db, session } = await requireSession(req);
    const p = req.nextUrl.searchParams;
    return NextResponse.json(await stageCounts(db, session.id, { from: isISODate(p.get("from")) ? p.get("from") : null, to: isISODate(p.get("to")) ? p.get("to") : null }));
  } catch (err) {
    return errorResponse(err);
  }
}
