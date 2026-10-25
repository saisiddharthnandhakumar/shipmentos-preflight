"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import type { BookingListItem } from "@/lib/client/types";
import { BookingDetail } from "../booking/booking-detail";
import { Button, Drawer, Notice, Skeleton, StatusPill, cx, relativeTime } from "../ui";

type Source = "all" | "chat" | "excel";
const STATUSES = ["Draft", "Blocked", "Needs attention", "Ready to submit"] as const;

export function BookingsHistory() {
  const [source, setSource] = useState<Source>("all");
  const [status, setStatus] = useState<string>("");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [result, setResult] = useState<{ key: string; items: BookingListItem[]; cursor: string | null; error: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const query = useCallback(
    (c?: string | null) => {
      const p = new URLSearchParams({ limit: "30" });
      if (source !== "all") p.set("source", source);
      if (status) p.set("status", status);
      if (debounced) p.set("q", debounced);
      if (c) p.set("cursor", c);
      return `/api/bookings?${p}`;
    },
    [source, status, debounced],
  );

  const key = query();
  useEffect(() => {
    let alive = true;
    api<{ items: BookingListItem[]; nextCursor: string | null }>(key)
      .then((r) => alive && setResult({ key, items: r.items, cursor: r.nextCursor, error: null }))
      .catch((e) => alive && setResult({ key, items: [], cursor: null, error: e instanceof ApiClientError ? e.message : "Couldn't load bookings." }));
    return () => {
      alive = false;
    };
  }, [key]);
  // Results for an older filter are never shown as if they matched the current one.
  const current = result && result.key === key ? result : null;
  const items = current?.error ? null : (current?.items ?? null);
  const error = current?.error ?? null;
  const cursor = current?.cursor ?? null;

  async function more() {
    if (!cursor || !current) return;
    setLoadingMore(true);
    try {
      const r = await api<{ items: BookingListItem[]; nextCursor: string | null }>(query(cursor));
      setResult({ ...current, items: [...current.items, ...r.items], cursor: r.nextCursor });
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-[-0.01em] text-text">All bookings</h1>
        <p className="mt-1 text-sm text-muted">Every booking from your chats and Excel uploads in this browser, most recently active first.</p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Source" className="inline-flex rounded-lg bg-raised p-0.5">
            {(["all", "chat", "excel"] as Source[]).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={source === s}
                onClick={() => setSource(s)}
                className={cx("h-8 rounded-md px-3 text-[13px] font-medium", source === s ? "bg-white text-text shadow-[0_0_0_1px_var(--border)]" : "text-muted hover:text-text")}
                data-testid={`source-${s}`}
              >
                {s === "all" ? "All" : s === "chat" ? "Chats" : "Excel imports"}
              </button>
            ))}
          </div>
          <label className="text-[13px] text-muted">
            <span className="sr-only">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-lg border border-control bg-white px-2.5 text-[13px] text-text">
              <option value="">Any status</option>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="ml-auto block w-full sm:w-72">
            <span className="sr-only">Search bookings</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search route, seller or booking ID" className="h-9 w-full rounded-lg border border-control bg-white px-3 text-[13px] placeholder:text-faint" />
          </label>
        </div>

        {error ? (
          <div className="mt-4">
            <Notice tone="error">{error}</Notice>
          </div>
        ) : items === null ? (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : items.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-control px-4 py-5 text-[13px] text-muted">
            {source === "all" && !status && !debounced ? (
              <>
                Nothing here yet. <Link href="/chat" className="font-medium text-accent">Start a chat</Link> or <Link href="/upload" className="font-medium text-accent">upload a workbook</Link>.
              </>
            ) : (
              "No bookings match these filters."
            )}
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[680px] text-[13px]" data-testid="bookings-table">
              <thead>
                <tr className="text-left text-[12px] text-muted">
                  <th className="py-2 pr-3 font-normal">Booking</th>
                  <th className="py-2 pr-3 font-normal">Source</th>
                  <th className="py-2 pr-3 font-normal">Status</th>
                  <th className="py-2 pr-3 text-right font-normal">Red</th>
                  <th className="py-2 pr-3 text-right font-normal">Amber</th>
                  <th className="py-2 text-right font-normal">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {items.map((b) => (
                  <tr key={b.id} className="border-t border-rule hover:bg-raised" data-testid="booking-row" data-source={b.source}>
                    <td className="py-2.5 pr-3">
                      {b.source === "chat" ? (
                        <Link href={`/chat/${b.id}`} className="font-medium text-text hover:underline">
                          {b.title}
                        </Link>
                      ) : (
                        <button type="button" onClick={() => setOpen(b.id)} className="text-left font-medium text-text hover:underline">
                          {b.title}
                        </button>
                      )}
                      <span className="block text-[12px] text-muted">{b.sellerName ?? "Seller not given yet"}</span>
                    </td>
                    <td className="py-2.5 pr-3 text-muted">{b.source === "chat" ? "Chat" : "Excel import"}</td>
                    <td className="py-2.5 pr-3">
                      <StatusPill status={b.status} />
                    </td>
                    <td className={cx("num py-2.5 pr-3 text-right", b.redCount ? "font-medium text-red-ink" : "text-muted")}>{b.redCount}</td>
                    <td className={cx("num py-2.5 pr-3 text-right", b.amberCount ? "font-medium text-amber-ink" : "text-muted")}>{b.amberCount}</td>
                    <td className="py-2.5 text-right text-muted">
                      <time dateTime={b.lastActivityAt}>{relativeTime(b.lastActivityAt)}</time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cursor && (
              <div className="mt-3">
                <Button size="sm" onClick={() => void more()} disabled={loadingMore}>
                  {loadingMore ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      <Drawer open={Boolean(open)} onClose={() => setOpen(null)} label="Booking details">
        {open && <BookingDetail bookingId={open} onClose={() => setOpen(null)} />}
      </Drawer>
    </div>
  );
}
