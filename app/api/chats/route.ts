import { NextResponse, type NextRequest } from "next/server";
import { listChats } from "@/lib/db/repo";
import { pageLimit } from "@/lib/server/api-schemas";
import { errorResponse, requireSession } from "@/lib/server/http";

export const runtime = "nodejs";

/** Previous chats for this anonymous session only, most recently active first. */
export async function GET(req: NextRequest) {
  try {
    const { db, session } = await requireSession(req);
    const p = req.nextUrl.searchParams;
    return NextResponse.json(await listChats(db, session.id, { cursor: p.get("cursor"), limit: pageLimit(p.get("limit"), 30, 100) }));
  } catch (err) {
    return errorResponse(err);
  }
}
