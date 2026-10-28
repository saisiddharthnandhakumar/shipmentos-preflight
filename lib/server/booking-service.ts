import { todayUK } from "../domain/dates";
import { evaluateBooking } from "../domain/evaluate";
import type { DraftBooking, Evaluation, InputIssue } from "../domain/schemas";
import type { Exec } from "../db/repo";
import { issueResolvedByDraft } from "../import/parse-xlsx";
import { issuesForBooking, listRevisions, loadBooking } from "../db/repo";
import { getCarrierOptions } from "./reference";

export async function evaluateDraft(db: Exec, draft: DraftBooking, inputIssues: InputIssue[] = [], now = new Date()): Promise<Evaluation> {
  const options = await getCarrierOptions(db);
  return evaluateBooking(draft, { todayUK: todayUK(now), options, inputIssues });
}

export type BookingSnapshot = {
  booking: {
    id: string;
    source: "chat" | "excel";
    title: string;
    revision: number;
    status: string;
    externalBookingId: string | null;
    importBatchId: string | null;
    sourceRow: number | null;
    messageCount: number;
    confirmedAt: string | null;
    confirmedRevision: number | null;
    createdAt: string;
    lastActivityAt: string;
  };
  draft: DraftBooking;
  evaluation: Evaluation;
  revisions: { revision: number; source: string; changedFields: unknown; createdAt: string }[];
};

/**
 * Canonical state for one owned booking. The evaluation is recomputed from the stored canonical
 * draft (deterministic, cheap) so date-dependent checks like R-10 are always current; the stored
 * per-revision snapshot remains the audit record.
 */
export async function bookingSnapshot(db: Exec, sessionId: string, bookingId: string): Promise<BookingSnapshot | null> {
  const loaded = await loadBooking(db, sessionId, bookingId);
  if (!loaded) return null;
  const { row, draft } = loaded;
  const issues = row.source === "excel" ? await issuesForBooking(db, sessionId, bookingId) : [];
  const inputIssues: InputIssue[] = issues.map((i) => ({
    code: i.issueCode,
    severity: i.severity as InputIssue["severity"],
    message: i.message,
    sheet: i.sheet as InputIssue["sheet"],
    row: i.sourceRow ?? undefined,
    column: i.columnName ?? undefined,
    rawValue: i.rawValue ?? undefined,
  }));
  // Import-time issues about a field the seller has since filled in are resolved: don't show them again.
  const evaluation = await evaluateDraft(db, draft, inputIssues.filter((i) => !issueResolvedByDraft(i, draft)));
  const revisions = (await listRevisions(db, sessionId, bookingId)) ?? [];
  return {
    booking: {
      id: row.id,
      source: row.source,
      title: row.title,
      revision: row.revision,
      status: evaluation.status,
      externalBookingId: row.externalBookingId,
      importBatchId: row.importBatchId,
      sourceRow: row.sourceRow,
      messageCount: row.messageCount,
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      confirmedRevision: row.confirmedRevision,
      createdAt: row.createdAt.toISOString(),
      lastActivityAt: row.lastActivityAt.toISOString(),
    },
    draft,
    evaluation,
    revisions: revisions.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
  };
}
