import { persistImport } from "@/lib/db/repo";
import type { Db } from "@/lib/db/client";
import { todayUK } from "@/lib/domain/dates";
import { evaluateBooking } from "@/lib/domain/evaluate";
import { parseWorkbook, sanitizeFilename } from "@/lib/import/parse-xlsx";
import { getCarrierOptions } from "./reference";

/** Parse, evaluate and persist one Bookings + Items workbook for a session. No AI; raw bytes are never stored. */
export async function importWorkbookBytes(db: Db, sessionId: string, bytes: Buffer, name: string) {
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
    const filename = sanitizeFilename(name);
    const saved = await persistImport(
      db,
      sessionId,
      { filename, bookingRowCount: parsed.stats.bookingRows, itemRowCount: parsed.stats.itemRows, status, summary },
      records,
      allIssues,
    );
  return { batchId: saved.batchId, filename, status, summary, createdAt: saved.createdAt };
}
