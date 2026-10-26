import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, assertUuid, enforceRateLimit, errorResponse, requireSession } from "@/lib/server/http";
import { runImportTurn } from "@/lib/server/turns";
import { readWorkbookUpload } from "@/lib/server/upload";

export const runtime = "nodejs";
export const maxDuration = 60;

const Fields = z.object({ expectedRevision: z.coerce.number().int().min(0), requestId: z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/) });

/** Read an .xlsx into this chat's booking (replacing what is there). No AI; raw bytes are never stored. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/chats/[bookingId]/import">) {
  try {
    assertSameOrigin(req);
    const { bookingId } = await ctx.params;
    assertUuid(bookingId);
    const { db, session } = await requireSession(req);
    enforceRateLimit(req, session.id, "chat-import", 12);
    const { form, bytes, name } = await readWorkbookUpload(req);
    const f = Fields.parse({ expectedRevision: form.get("expectedRevision"), requestId: form.get("requestId") });
    const r = await runImportTurn({ db, sessionId: session.id, bookingId, bytes, filename: name.replace(/[^\w .()\-]/g, "_").slice(0, 80), ...f });
    return NextResponse.json(r);
  } catch (err) {
    return errorResponse(err);
  }
}
