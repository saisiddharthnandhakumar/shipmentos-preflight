"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import type { BookingListItem } from "@/lib/client/types";
import { formatUK } from "@/lib/domain/dates";
import { Button, EmptyState, Notice, PageHeader, Skeleton, StatusPill, cx, relativeTime } from "../ui";

type Source = "all" | "chat" | "excel";
const STATUSES = ["Draft", "Blocked", "Needs attention", "Ready to submit"] as const;

export function BookingsHistory() {
  // Filters live in the URL so a filtered view can be refreshed or shared within this browser.
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const source: Source = params.get("source") === "chat" || params.get("source") === "excel" ? (params.get("source") as Source) : "all";
  const status = (STATUSES as readonly string[]).includes(params.get("status") ?? "") ? params.get("status")! : "";
  const debounced = params.get("q") ?? "";
  const [q, setQ] = useState(debounced);
  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value && value !== "all") next.set(key, value);
      else next.delete(key);
      router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
    },
    [params, pathname, router],
  );
  const setSource = (s: Source) => setParam("source", s);
  const setStatus = (s: string) => setParam("status", s);
  const [result, setResult] = useState<{ key: string; items: BookingListItem[]; cursor: string | null; error: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (q.trim() === debounced) return;
    const t = setTimeout(() => setParam("q", q.trim()), 250);
    return () => clearTimeout(t);
  }, [q, debounced, setParam]);

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

  const route = (b: BookingListItem) => {
    const from = b.originCity;
    const to = b.destinationCity ?? b.destinationCountry;
    return from || to ? `${from ?? "?"} → ${to ?? "?"}` : "Route not given yet";
  };
  const name = (b: BookingListItem) => (b.source === "excel" && b.externalBookingId ? b.externalBookingId : b.title);
  const filtered = Boolean(status || debounced || source !== "all");

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 py-6 lg:px-8 lg:py-8">
        <PageHeader
          title="All bookings"
          description="Every booking from your chats and Excel uploads in this browser, most recently active first."
          actions={
            <Link href="/chat?new=bookings" className="inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-sm font-medium text-on-primary hover:bg-primary-hover">
              New booking
            </Link>
          }
        />

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Status" className="flex flex-wrap gap-1.5">
            {["", ...STATUSES].map((s) => (
              <button
                key={s || "all"}
                type="button"
                aria-pressed={status === s}
                onClick={() => setStatus(s)}
                className={cx("h-8 rounded-full px-3 text-small font-medium transition-colors", status === s ? "bg-primary text-on-primary" : "bg-raised text-muted hover:bg-active hover:text-text")}
              >
                {s || "All"}
              </button>
            ))}
          </div>
          <label className="ml-auto block w-full sm:w-72">
            <span className="sr-only">Search bookings</span>
            <input name="q" type="search" autoComplete="off" spellCheck={false} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search route, seller or booking ID…" className="h-9 w-full rounded-lg border border-control bg-sheet px-3 text-small placeholder:text-faint" />
          </label>
        </div>
        <div role="group" aria-label="Source" className="mt-3 inline-flex rounded-lg bg-raised p-0.5">
          {(["all", "chat", "excel"] as Source[]).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={source === s}
              onClick={() => setSource(s)}
              className={cx("h-7 rounded-md px-3 text-small font-medium", source === s ? "bg-sheet text-text" : "text-muted hover:text-text")}
              data-testid={`source-${s}`}
            >
              {s === "all" ? "Any source" : s === "chat" ? "Chats" : "Excel imports"}
            </button>
          ))}
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
          <div className="mt-6">
            {!filtered ? (
              <EmptyState
                title="No bookings yet"
                actions={
                  <>
                    <Link href="/chat?new=bookings" className="inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-sm font-medium text-on-primary hover:bg-primary-hover">
                      Describe a shipment
                    </Link>
                    <Link href="/upload" className="inline-flex h-9 items-center rounded-lg border border-control bg-sheet px-3.5 text-sm font-medium text-text hover:bg-raised">
                      Upload a spreadsheet
                    </Link>
                  </>
                }
              >
                Bookings from chats and Excel uploads show up here.
              </EmptyState>
            ) : (
              <EmptyState title="No bookings match these filters">Try a different status or clear the search.</EmptyState>
            )}
          </div>
        ) : (
          <div className="mt-4">
            {/* Phone: two-line rows (identity + status, then route and activity) */}
            <ul className="divide-y divide-rule sm:hidden" aria-label="Bookings">
              {items.map((b) => (
                <li key={b.id}>
                  <Link href={`/bookings/${b.id}`} className="block py-3">
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate text-small font-medium text-text">{name(b)}</span>
                      <StatusPill status={b.status} />
                    </span>
                    <span className="num mt-0.5 block truncate text-caption text-muted">
                      {route(b)} · {b.pallets != null ? `${b.pallets} pallets · ` : ""}
                      {relativeTime(b.lastActivityAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[760px] text-small" data-testid="bookings-table">
                <thead>
                  <tr className="text-left text-caption text-muted">
                    <th className="py-2 pr-3 font-medium">Booking</th>
                    <th className="py-2 pr-3 font-medium">Route</th>
                    <th className="py-2 pr-3 text-right font-medium">Pallets</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Ready</th>
                    <th className="py-2 text-right font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((b) => (
                    <tr key={b.id} className="relative border-t border-rule hover:bg-raised" data-testid="booking-row" data-source={b.source}>
                      <td className="py-3 pr-3">
                        <Link href={`/bookings/${b.id}`} className="font-medium text-text after:absolute after:inset-0 hover:underline">
                          {name(b)}
                        </Link>
                        <span className="block text-caption text-muted">
                          {b.sellerName ?? "Seller not given yet"} · {b.source === "chat" ? "Chat" : "Excel"}
                        </span>
                      </td>
                      <td className="py-3 pr-3 text-text">{route(b)}</td>
                      <td className="num py-3 pr-3 text-right text-text">{b.pallets ?? "—"}</td>
                      <td className="py-3 pr-3">
                        <StatusPill status={b.status} />
                        {(b.redCount > 0 || b.amberCount > 0) && (
                          <span className="num mt-1 block text-caption text-muted">
                            {b.redCount} to fix · {b.amberCount} to check
                          </span>
                        )}
                      </td>
                      <td className="num py-3 pr-3 text-text">{b.readyToShipDate ? formatUK(b.readyToShipDate) : "—"}</td>
                      <td className="py-3 text-right text-muted">
                        <time dateTime={b.lastActivityAt}>{relativeTime(b.lastActivityAt)}</time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
    </div>
  );
}
