import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getFilterExtractor } from "@/lib/ai/filter-extract";
import { AiError } from "@/lib/ai/gemini-client";
import { getImportBatch, listBookings } from "@/lib/db/repo";
import { BookingFilterSchema } from "@/lib/domain/booking-filter";
import { LIMITS } from "@/lib/domain/schemas";
import { ApiError, assertSameOrigin, assertUuid, enforceRateLimit, errorResponse, readJson, requireSession } from "@/lib/server/http";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ message: z.string().trim().min(1).max(LIMITS.maxMessageChars), current: BookingFilterSchema.default({}) });
const distinct = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();

/**
 * Chat over an uploaded workbook: one sentence in, a filter out. The page applies the filter to the
 * rows it already holds, so the model never sees bookings beyond the distinct values it may name.
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/imports/[id]/filter">) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    assertUuid(id, "import");
    const { db, session } = await requireSession(req);
    enforceRateLimit(req, session.id, "import-filter", 20);
    const body = Body.parse(await readJson(req));
    if (!(await getImportBatch(db, session.id, id))) throw new ApiError(404, "NOT_FOUND", "That import was not found in this browser session.");
    const { items } = await listBookings(db, session.id, { limit: 2000, batchId: id, source: "excel" });
    const facets = {
      total: items.length,
      originCities: distinct(items.map((b) => b.originCity)),
      destinationCities: distinct(items.map((b) => b.destinationCity)),
      destinationCountries: distinct(items.map((b) => b.destinationCountry)),
      sellers: distinct(items.map((b) => b.sellerName)).slice(0, 60),
    };
    try {
      return NextResponse.json(await getFilterExtractor()({ message: body.message, current: body.current, facets }));
    } catch (err) {
      if (err instanceof AiError) throw new ApiError(err.kind === "invalid_output" ? 422 : 503, "AI_UNAVAILABLE", err.message);
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
