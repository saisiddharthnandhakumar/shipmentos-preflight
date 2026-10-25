"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiClientError, newRequestId } from "@/lib/client/api";
import { draftReferenceOf } from "@/lib/client/reference";
import type { BookingSnapshot, PatchOp, TurnResponse } from "@/lib/client/types";
import { EditBookingDialog } from "../chat/edit-booking";
import { Button, Card, Notice, Skeleton } from "../ui";
import { CarrierPanel, Collapsible, FactsList, FixList, InputIssues, ItemsTable, NextSteps, PreflightStrip, RuleChecklist, StatusSummary } from "./parts";

/** One booking, whether it came from chat or Excel: what is wrong, what to do, then the details. Edit and save the draft in place. */
export function BookingPage({ bookingId }: { bookingId: string }) {
  const [snap, setSnap] = useState<BookingSnapshot | null>(null);
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
  const [reload, setReload] = useState(0);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<BookingSnapshot>(`/api/bookings/${bookingId}`)
      .then((s) => alive && (setSnap(s), setError(null)))
      .catch((e) => alive && setError({ message: e instanceof ApiClientError ? e.message : "Couldn't load this booking.", notFound: e instanceof ApiClientError && e.status === 404 }));
    return () => {
      alive = false;
    };
  }, [bookingId, reload]);

  const jump = (id: string) => {
    setHighlight(id);
    document.getElementById(`rule-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  async function saveEdit(ops: PatchOp[]) {
    if (!snap) return;
    setEditBusy(true);
    setEditError(null);
    try {
      const r = await api<TurnResponse>(`/api/bookings/${bookingId}`, { method: "PATCH", body: { expectedRevision: snap.booking.revision, requestId: newRequestId(), operations: ops } });
      setSnap(r.snapshot);
      setEditing(false);
    } catch (e) {
      const err = e as ApiClientError;
      if (err.code === "STALE_REVISION") {
        const latest = (err.details as { snapshot?: BookingSnapshot } | undefined)?.snapshot;
        if (latest) setSnap(latest);
        setEditError("This booking changed elsewhere. The latest version is loaded. Please review and save again.");
      } else setEditError(`Not saved. ${err.message ?? ""}`);
    } finally {
      setEditBusy(false);
    }
  }

  async function confirmDraft() {
    if (!snap) return;
    setConfirmBusy(true);
    setNotice(null);
    try {
      const r = await api<TurnResponse>(`/api/bookings/${bookingId}/confirm`, { method: "POST", body: { expectedRevision: snap.booking.revision, requestId: newRequestId() } });
      setSnap(r.snapshot);
    } catch (e) {
      setNotice(e instanceof ApiClientError ? e.message : "Couldn't save the draft.");
    } finally {
      setConfirmBusy(false);
    }
  }

  if (error?.notFound)
    return (
      <div className="m-auto max-w-md p-6 text-center">
        <h1 className="text-heading">Booking not found</h1>
        <p className="mt-2 text-sm text-muted">It may have been deleted, or it belongs to a different browser session. Bookings are only available in the browser that created them.</p>
        <Link href="/bookings" className="mt-4 inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-sm font-medium text-on-primary">
          Back to all bookings
        </Link>
      </div>
    );

  const evaluation = snap?.evaluation ?? null;
  const missingKeys = new Set(evaluation?.missingFields.map((m) => m.key) ?? []);
  const confirmed = snap?.booking.confirmedRevision != null && snap.booking.confirmedRevision === snap.booking.revision;
  const canConfirm = evaluation && (evaluation.status === "Ready to submit" || evaluation.status === "Needs attention") && !confirmed;
  const isChat = snap?.booking.source === "chat";
  const sourceLine = snap ? (isChat ? "Created in chat" : `Imported from Excel${snap.booking.sourceRow ? ` · Bookings row ${snap.booking.sourceRow}` : ""}`) : "";
  const hasIssues = snap?.evaluation.inputIssues.some((i) => i.severity !== "info");
  const nothingToFix = evaluation && evaluation.redCount === 0 && evaluation.amberCount === 0;

  return (
    <article className="h-full overflow-y-auto" data-testid="booking-detail">
      <div className="mx-auto max-w-6xl px-4 pt-2 pb-8 lg:px-6">
        <nav aria-label="Breadcrumb" className="mb-2 text-small">
          <Link href="/bookings" className="text-muted hover:text-text hover:underline">
            ← All bookings
          </Link>
        </nav>

        {error ? (
          <Notice tone="error" action={<button className="underline" onClick={() => { setError(null); setReload((n) => n + 1); }}>Retry</button>}>
            {error.message}
          </Notice>
        ) : !snap || !evaluation ? (
          <div className="space-y-4" aria-label="Loading booking">
            <Skeleton className="h-9 w-72" />
            <Skeleton className="h-12" />
            <Skeleton className="h-64" />
          </div>
        ) : (
          <>
            <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
              <div className="min-w-0">
                <h1 className="truncate text-title text-text">{snap.booking.title}</h1>
                <p className="mt-1 text-small text-muted">
                  {sourceLine}
                  {snap.draft.sellerName ? ` · ${snap.draft.sellerName}` : ""}
                </p>
              </div>
              <div className="flex flex-none flex-wrap items-center gap-2">
                {isChat && (
                  <Link href={`/chat/${snap.booking.id}`} className="inline-flex h-9 items-center rounded-lg border border-control bg-sheet px-3.5 text-sm font-medium text-text hover:bg-raised">
                    Open conversation
                  </Link>
                )}
                <Button onClick={() => setEditing(true)} data-testid="edit-booking">
                  Edit booking
                </Button>
                {canConfirm && (
                  <Button variant="primary" onClick={() => void confirmDraft()} disabled={confirmBusy} data-testid="confirm-draft">
                    {confirmBusy ? "Saving…" : "Save as ready-to-submit draft"}
                  </Button>
                )}
              </div>
            </header>

            {notice && (
              <div className="mt-4">
                <Notice tone="error">{notice}</Notice>
              </div>
            )}

            <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
              <div className="space-y-6 self-start rounded-3xl bg-sheet p-5 sm:p-6">
                <StatusSummary evaluation={evaluation} />
                {confirmed && (
                  <div className="rounded-xl border border-pass-line bg-pass-bg px-4 py-3" data-testid="confirmation">
                    <p className="text-small font-medium text-pass-ink">Saved as a ready-to-submit draft · {draftReferenceOf(snap.booking.id)}</p>
                    <p className="mt-1 text-small text-pass-ink">This is a prepared booking, not a carrier booking. Submit it to the carrier yourself. Any later change re-runs the checks and clears this confirmation.</p>
                  </div>
                )}
                <PreflightStrip rules={evaluation.rules} onSelect={jump} />
                <FixList rules={evaluation.rules} highlight={highlight} />
                {nothingToFix && !hasIssues && <p className="rounded-xl bg-pass-bg px-4 py-3 text-sm text-pass-ink">All ten checks pass. Nothing needs fixing.</p>}
                {hasIssues && (
                  <section aria-labelledby="issues-h">
                    <h2 id="issues-h" className="mb-2 text-heading text-text">
                      Spreadsheet issues
                    </h2>
                    <InputIssues issues={evaluation.inputIssues} />
                  </section>
                )}
                <section aria-labelledby="next-h">
                  <h2 id="next-h" className="mb-2 text-heading text-text">
                    Next steps
                  </h2>
                  <NextSteps evaluation={evaluation} />
                </section>
              </div>

              <div className="space-y-4">
                <Card tone="dark" title="Carrier and price" icon={<svg viewBox="0 0 16 16" className="size-4" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1.5 4.5h8v6h-8zM9.5 7h3l2 2v1.5h-5" /><circle cx="4.5" cy="11.5" r="1.2" /><circle cx="11.5" cy="11.5" r="1.2" /></svg>}>
                  <CarrierPanel carrier={evaluation.carrier} status={evaluation.status} timeline={evaluation.timeline} />
                </Card>
                <div className="rounded-3xl bg-sheet px-5 sm:px-6 [&>section:first-child]:border-t-0">
                <Collapsible title="Shipment details">
                  <FactsList draft={snap.draft} missingKeys={missingKeys} />
                </Collapsible>
                <Collapsible title="Items" count={String(snap.draft.items.length)}>
                  <ItemsTable items={snap.draft.items} showRows={!isChat} />
                </Collapsible>
                <Collapsible title="Checks that passed" count={`${evaluation.rules.filter((r) => r.status === "pass").length}/10`} defaultOpen={false}>
                  <RuleChecklist rules={evaluation.rules} filter="passing" highlight={highlight} />
                  {evaluation.notes.map((n, i) => (
                    <p key={i} className="mt-2 rounded-lg bg-raised px-3 py-2 text-caption text-muted">
                      Clarification (not scored): {n}
                    </p>
                  ))}
                </Collapsible>
                {snap.revisions.length > 1 && (
                  <Collapsible title="Change log" count={String(snap.revisions.length - 1)} defaultOpen={false}>
                    <ol className="space-y-1 text-caption text-muted" data-testid="change-log">
                      {snap.revisions
                        .filter((r) => r.revision > 0)
                        .map((r) => (
                          <li key={r.revision} className="flex gap-2">
                            <span className="num w-10 flex-none text-text">rev {r.revision}</span>
                            <span className="min-w-0 flex-1">
                              {r.source === "chat" ? "Chat" : r.source === "edit" ? "Direct edit" : r.source === "confirm" ? "Saved as draft" : r.source}
                              {Array.isArray(r.changedFields) && r.changedFields.length ? ` · ${(r.changedFields as string[]).join(", ")}` : " · no field changes"}
                            </span>
                          </li>
                        ))}
                    </ol>
                  </Collapsible>
                )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {snap && (
        <EditBookingDialog
          open={editing}
          draft={snap.draft}
          onClose={() => {
            setEditing(false);
            setEditError(null);
          }}
          onSubmit={(ops) => void saveEdit(ops)}
          busy={editBusy}
          error={editError}
        />
      )}
    </article>
  );
}
