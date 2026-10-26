import { NextResponse, type NextRequest } from "next/server";
import { importWorkbookBytes } from "@/lib/server/import-service";
import { readWorkbookUpload } from "@/lib/server/upload";
import { assertSameOrigin, enforceRateLimit, errorResponse, requireSession } from "@/lib/server/http";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Upload a Bookings + Items workbook. Works with zero AI calls. Raw bytes are never stored. */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { db, session } = await requireSession(req);
    enforceRateLimit(req, session.id, "import", 12);
    const { bytes, name } = await readWorkbookUpload(req);

    const result = await importWorkbookBytes(db, session.id, bytes, name);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
