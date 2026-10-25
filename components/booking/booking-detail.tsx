"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import type { BookingSnapshot } from "@/lib/client/types";
import { Button, Notice, Skeleton } from "../ui";
import { CarrierPanel, Collapsible, InputIssues, ItemsTable, NextSteps, PreflightStrip, RuleChecklist, StatusSummary } from "./parts";

/** Full stored result for one booking (used for Excel bookings and in All bookings). */
export function BookingDetail({ bookingId, onClose }: { bookingId: string; onClose?: () => void }) {
  const [snap, setSnap] = useState<BookingSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);

  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    api<BookingSnapshot>(`/api/bookings/${bookingId}`)
      .then((s) => alive && setSnap(s))
      .catch((e) => alive && setError(e instanceof ApiClientError ? e.message : "Couldn't load this booking."));
    return () => {
      alive = false;
    };
  }, [bookingId, reload]);

  const jump = (id: string) => {
    setHighlight(id);
    document.getElementById(`rule-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <article className="flex h-full flex-col" data-testid="booking-detail">
      <header className="flex flex-none items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-text">{snap?.booking.title ?? "Booking"}</h2>
          {snap && (
            <p className="mt-0.5 text-[12px] text-muted">
              {snap.booking.source === "excel" ? `Imported from Excel${snap.booking.sourceRow ? ` · Bookings row ${snap.booking.sourceRow}` : ""}` : "Created in chat"}
              {snap.draft.sellerName ? ` · ${snap.draft.sellerName}` : ""}
            </p>
          )}
        </div>
        {onClose && (
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close booking details">
            Close
          </Button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-8">
        {error ? (
          <Notice tone="error" action={<button className="underline" onClick={() => { setError(null); setReload((n) => n + 1); }}>Retry</button>}>
            {error}
          </Notice>
        ) : !snap ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-11" />
            <Skeleton className="h-40" />
          </div>
        ) : (
          <div className="space-y-4">
            <StatusSummary evaluation={snap.evaluation} />
            <PreflightStrip rules={snap.evaluation.rules} onSelect={jump} />
            {snap.booking.source === "chat" && (
              <Link href={`/chat/${snap.booking.id}`} className="inline-block text-[13px] font-medium text-accent underline-offset-2 hover:underline">
                Open the conversation →
              </Link>
            )}
            {snap.evaluation.inputIssues.some((i) => i.severity !== "info") && (
              <div>
                <h3 className="mb-2 text-[13px] font-semibold">Input issues (not rulebook checks)</h3>
                <InputIssues issues={snap.evaluation.inputIssues} />
              </div>
            )}
            <Collapsible title="Pre-flight checks" count={`${snap.evaluation.rules.filter((r) => r.status === "pass").length}/10 pass`}>
              <RuleChecklist rules={snap.evaluation.rules} highlight={highlight} />
              {snap.evaluation.notes.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {snap.evaluation.notes.map((n, i) => (
                    <li key={i} className="rounded-lg bg-raised px-3 py-2 text-[12px] text-muted">
                      Clarification (not scored): {n}
                    </li>
                  ))}
                </ul>
              )}
            </Collapsible>
            <Collapsible title="Carrier">
              <CarrierPanel carrier={snap.evaluation.carrier} status={snap.evaluation.status} timeline={snap.evaluation.timeline} />
            </Collapsible>
            <Collapsible title="Items" count={String(snap.draft.items.length)}>
              <ItemsTable items={snap.draft.items} showRows={snap.booking.source === "excel"} />
            </Collapsible>
            <Collapsible title="Next steps">
              <NextSteps evaluation={snap.evaluation} />
            </Collapsible>
          </div>
        )}
      </div>
    </article>
  );
}
