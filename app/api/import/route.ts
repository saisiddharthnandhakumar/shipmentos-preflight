import { NextResponse, type NextRequest } from "next/server";
import { persistImport } from "@/lib/db/repo";
import { todayUK } from "@/lib/domain/dates";
import { evaluateBooking } from "@/lib/domain/evaluate";
import { IMPORT_LIMITS, parseWorkbook, sanitizeFilename } from "@/lib/import/parse-xlsx";
import { ApiError, assertSameOrigin, enforceRateLimit, errorResponse, requireSession } from "@/lib/server/http";
import { getCarrierOptions } from "@/lib/server/reference";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Upload a Bookings + Items workbook. Works with zero AI calls. Raw bytes are never stored. */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { db, session } = await requireSession(req);
    enforceRateLimit(req, session.id, "import", 12);
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > IMPORT_LIMITS.maxBytes + 64 * 1024) throw new ApiError(413, "TOO_LARGE", "The file is larger than 5 MB.");
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ApiError(400, "INVALID_UPLOAD", "Expected a multipart upload with a 'file' field.");
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "INVALID_UPLOAD", "Choose an .xlsx file to upload.");
    if (!/\.xlsx$/i.test(file.name)) throw new ApiError(400, "INVALID_TYPE", "Only .xlsx workbooks are supported (Excel 2007+).");
    if (file.size > IMPORT_LIMITS.maxBytes) throw new ApiError(413, "TOO_LARGE", "The file is larger than 5 MB.");
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new ApiError(400, "INVALID_TYPE", "That file isn't a valid .xlsx workbook.");

    const parsed = await parseWorkbook(bytes, () => crypto.randomUUID());
    const options = await getCarrierOptions(db);
    const today = todayUK();
    const records = parsed.bookings.map((b) => ({
      draft: b.draft,
      evaluation: evaluateBooking(b.draft, { todayUK: today, options, inputIssues: b.issues }),
      sourceRow: b.sourceRow,
      rawRow: b.raw,
      itemRaw: b.itemRaw as Map<string, unknown>,
    }));
    const count = (s: string) => records.filter((r) => r.evaluation.status === s).length;
    const ruleCounts: Record<string, number> = {};
    for (const r of records) for (const rule of r.evaluation.rules) if (rule.status === "fail") ruleCounts[rule.ruleId] = (ruleCounts[rule.ruleId] ?? 0) + 1;
    const allIssues = [...parsed.issues, ...parsed.bookings.flatMap((b) => b.issues)];
    const summary = {
      total: records.length,
      ready: count("Ready to submit"),
      needsAttention: count("Needs attention"),
      blocked: count("Blocked"),
      bookingsWithInputIssues: parsed.bookings.filter((b) => b.issues.some((i) => i.severity === "error")).length,
      inputErrors: allIssues.filter((i) => i.severity === "error").length,
      inputWarnings: allIssues.filter((i) => i.severity === "warning").length,
      ruleFailures: ruleCounts,
      skippedExampleRows: parsed.stats.skippedExampleRows,
      headerRows: parsed.stats.headerRows,
      itemRows: parsed.stats.itemRows,
      todayUK: today,
    };
    const status = !records.length ? "failed" : summary.inputErrors ? "completed_with_issues" : "completed";
    const filename = sanitizeFilename(file.name);
    const saved = await persistImport(
      db,
      session.id,
      { filename, bookingRowCount: parsed.stats.bookingRows, itemRowCount: parsed.stats.itemRows, status, summary },
      records,
      allIssues,
    );
    return NextResponse.json({ batchId: saved.batchId, filename, status, summary, createdAt: saved.createdAt }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
