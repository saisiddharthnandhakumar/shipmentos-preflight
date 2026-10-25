"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import type { BookingListItem, BookingSnapshot } from "@/lib/client/types";
import { Button, EmptyState, Notice, PageHeader, SectionHeading, Skeleton, Stat, StatusPill, relativeTime } from "../ui";

const STATUSES = ["Blocked", "Needs attention", "Ready to submit", "Draft"] as const;
type Status = (typeof STATUSES)[number];
type Bucket = { items: BookingListItem[]; more: boolean };
type Buckets = Record<Status, Bucket>;

async function loadBuckets(): Promise<Buckets> {
  const parts = await Promise.all(
    STATUSES.map((s) => api<{ items: BookingListItem[]; nextCursor: string | null }>(`/api/bookings?limit=100&status=${encodeURIComponent(s)}`)),
  );
  return Object.fromEntries(STATUSES.map((s, i) => [s, { items: parts[i].items, more: parts[i].nextCursor !== null }])) as Buckets;
}

const countLabel = (b: Bucket) => `${b.items.length}${b.more ? "+" : ""}`;

export function TodayScreen() {
  const [data, setData] = useState<Buckets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    loadBuckets()
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e instanceof ApiClientError ? e.message : "Couldn't load your bookings."));
    return () => {
      alive = false;
    };
  }, [reload]);

  const total = data ? STATUSES.reduce((n, s) => n + data[s].items.length, 0) : 0;
  const attention = data ? [...data.Blocked.items, ...data["Needs attention"].items].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)) : [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-8 px-4 py-6 lg:px-8 lg:py-8">
        <PageHeader
          title="Today"
          description="What needs your attention before a booking can go to the carrier."
          actions={
            <>
              <Link href="/upload" className="inline-flex h-9 items-center rounded-lg border border-control bg-sheet px-3.5 text-sm font-medium text-text hover:bg-raised">
                Upload Excel
              </Link>
              <Link href="/chat?new=today" className="inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-sm font-medium text-on-primary hover:bg-primary-hover">
                New booking
              </Link>
            </>
          }
        />

        {error ? (
          <Notice tone="error" action={<button className="underline" onClick={() => { setData(null); setReload((n) => n + 1); }}>Retry</button>}>
            {error}
          </Notice>
        ) : !data ? (
          <div className="space-y-4" aria-label="Loading your bookings">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : total === 0 ? (
          <EmptyState
            title="No bookings yet"
            actions={
              <>
                <Link href="/chat?new=today" className="inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-sm font-medium text-on-primary hover:bg-primary-hover">
                  Describe a shipment
                </Link>
                <Link href="/upload" className="inline-flex h-9 items-center rounded-lg border border-control bg-sheet px-3.5 text-sm font-medium text-text hover:bg-raised">
                  Upload a spreadsheet
                </Link>
              </>
            }
          >
            Tell the assistant about a UK to EU pallet shipment, or upload a workbook of bookings. Every booking is checked against ten rules, and nothing is sent to a carrier.
          </EmptyState>
        ) : (
          <>
            <section aria-label="Booking totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Blocked" value={countLabel(data.Blocked)} tone="red" glyph="red" href="/bookings?status=Blocked" hint="Must be fixed first" />
              <Stat label="Needs attention" value={countLabel(data["Needs attention"])} tone="amber" glyph="amber" href="/bookings?status=Needs%20attention" hint="Worth a check" />
              <Stat label="Ready to submit" value={countLabel(data["Ready to submit"])} tone="pass" glyph="pass" href="/bookings?status=Ready%20to%20submit" hint="Nothing left to fix" />
              <Stat label="Draft" value={countLabel(data.Draft)} tone="na" glyph="na" href="/bookings?status=Draft" hint="Still being filled in" />
            </section>

            <section aria-labelledby="attention-h" className="space-y-3">
              <SectionHeading id="attention-h" action={attention.length > 0 ? <Link href="/bookings?status=Blocked" className="text-small font-medium text-accent hover:underline">See all</Link> : undefined}>
                Needs your attention
              </SectionHeading>
              {attention.length === 0 ? (
                <p className="rounded-xl bg-pass-bg px-4 py-3 text-sm text-pass-ink">Nothing is blocked and nothing needs a check. You&apos;re up to date.</p>
              ) : (
                <ul className="divide-y divide-rule rounded-xl border border-border bg-sheet" data-testid="attention-list">
                  {attention.slice(0, 8).map((b, i) => (
                    <AttentionRow key={b.id} b={b} loadFix={i < 5} />
                  ))}
                </ul>
              )}
            </section>

            {data["Ready to submit"].items.length > 0 && (
              <section aria-labelledby="ready-h" className="space-y-3">
                <SectionHeading id="ready-h">Ready to submit</SectionHeading>
                <ul className="divide-y divide-rule rounded-xl border border-border bg-sheet">
                  {data["Ready to submit"].items.slice(0, 5).map((b) => (
                    <li key={b.id}>
                      <Link href={`/bookings/${b.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-raised">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-small font-medium text-text">{b.title}</span>
                          <span className="block truncate text-caption text-muted">{b.sellerName ?? "Seller not given"}</span>
                        </span>
                        <StatusPill status={b.status} className="hidden sm:inline-flex" />
                        <time dateTime={b.lastActivityAt} className="flex-none text-caption text-muted">{relativeTime(b.lastActivityAt)}</time>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
        {data && total > 0 && (
          <p className="text-caption text-muted">
            Bookings are kept in this browser for 7 days. <Button variant="ghost" size="sm" className="!h-auto !px-1 underline" onClick={() => setReload((n) => n + 1)}>Refresh</Button>
          </p>
        )}
      </div>
    </div>
  );
}

/** One booking that needs work: what it is, why it is stuck, and the first thing to do. */
function AttentionRow({ b, loadFix }: { b: BookingListItem; loadFix: boolean }) {
  const [fix, setFix] = useState<string | null>(null);
  useEffect(() => {
    if (!loadFix) return;
    let alive = true;
    api<BookingSnapshot>(`/api/bookings/${b.id}`)
      .then((s) => {
        if (!alive) return;
        const failing = s.evaluation.rules.filter((r) => r.status === "fail");
        const first = failing.sort((a, b) => (a.severity === b.severity ? a.ruleId.localeCompare(b.ruleId) : a.severity === "Red" ? -1 : 1))[0];
        const f = first?.findings[0];
        setFix(f ? `${f.fix}` : (s.evaluation.nextSteps[0] ?? s.evaluation.headline));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [b.id, loadFix]);
  const dest = b.destinationCountry;
  return (
    <li>
      <Link href={`/bookings/${b.id}`} className="block px-4 py-3 hover:bg-raised">
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block truncate text-small font-medium text-text">{b.title}</span>
            <span className="block truncate text-caption text-muted">
              {b.sellerName ?? "Seller not given"}
              {dest ? ` · ${dest}` : ""} · {b.source === "chat" ? "Chat" : "Excel"}
            </span>
          </span>
          <StatusPill status={b.status} />
        </span>
        {fix ? (
          <span className="mt-1.5 line-clamp-2 block text-small text-text">
            <span className="font-medium">To fix: </span>
            {fix}
          </span>
        ) : loadFix ? (
          <Skeleton className="mt-2 h-4 w-2/3" />
        ) : null}
        <span className="num mt-1.5 block text-caption text-muted">
          {b.redCount} to fix · {b.amberCount} to check · {relativeTime(b.lastActivityAt)}
        </span>
      </Link>
    </li>
  );
}
