import { NextResponse, type NextRequest } from "next/server";
import { getImportBatch, listBookings } from "@/lib/db/repo";
import { assertUuid, errorResponse, requireSession } from "@/lib/server/http";
import { ApiError } from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/imports/[id]">) {
  try {
    const { id } = await ctx.params;
    assertUuid(id, "import");
    const { db, session } = await requireSession(req);
    const found = await getImportBatch(db, session.id, id);
    if (!found) throw new ApiError(404, "NOT_FOUND", "That import was not found in this browser session.");
    const bookings = await listBookings(db, session.id, { limit: 2000, batchId: id, source: "excel" });
    const { batch, issues } = found;
    return NextResponse.json({
      batch: {
        id: batch.id,
        filename: batch.originalFilenameSanitized,
        bookingRowCount: batch.bookingRowCount,
        itemRowCount: batch.itemRowCount,
        status: batch.status,
        summary: batch.summary,
        createdAt: batch.createdAt.toISOString(),
      },
      issues: issues.map((i) => ({
        id: i.id,
        bookingId: i.bookingId,
        sheet: i.sheet,
        row: i.sourceRow,
        column: i.columnName,
        code: i.issueCode,
        severity: i.severity,
        message: i.message,
        rawValue: i.rawValue,
      })),
      bookings: bookings.items.sort((a, b) => (a.externalBookingId ?? "").localeCompare(b.externalBookingId ?? "", undefined, { numeric: true })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
