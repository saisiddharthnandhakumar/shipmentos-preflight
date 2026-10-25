import { NextResponse, type NextRequest } from "next/server";
import { listImportBatches } from "@/lib/db/repo";
import { errorResponse, requireSession } from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { db, session } = await requireSession(req);
    const batches = await listImportBatches(db, session.id);
    return NextResponse.json({ batches: batches.map((b) => ({ ...b, createdAt: b.createdAt.toISOString() })) });
  } catch (err) {
    return errorResponse(err);
  }
}
