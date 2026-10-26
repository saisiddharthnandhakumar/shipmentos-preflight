"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { draftReferenceOf } from "@/lib/client/reference";
import type { BookingListItem } from "@/lib/client/types";
import { isISODate, isTab, stageOf, TABS, type Tab } from "@/lib/domain/stage";
import { DateRangePicker } from "../date-range-picker";
import { Button, ConfirmDialog, EmptyState, Notice, PageHeader, Skeleton, StagePill, cx, relativeTime } from "../ui";

type Counts = { all: number; completed: number; sync: number; draft: number };

export const bookingId = (b: Pick<BookingListItem, "id" | "externalBookingId">) => b.externalBookingId ?? draftReferenceOf(b.id);
/** Chats reopen as the conversation; Excel rows have no chat, so they open their detail page. */
export const openHref = (b: Pick<BookingListItem, "id" | "source">) => (b.source === "chat" ? `/chat/${b.id}` : `/bookings/${b.id}`);

export function BookingsHistory() {
  // Filters live in the URL so a filtered view can be refreshed or shared within this browser.
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab: Tab = isTab(params.get("tab")) ? (params.get("tab") as Tab) : "all";
  const from = isISODate(params.get("from")) ? params.get("from") : null;
  const to = isISODate(params.get("to")) ? params.get("to") : null;
  const debounced = params.get("q") ?? "";
  const [q, setQ] = useState(debounced);
  const setParams = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(changes)) {
        if (v && v !== "all") next.set(k, v);
        else next.delete(k);
      }
      router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const [result, setResult] = useState<{ key: string; items: BookingListItem[]; cursor: string | null; error: string | null } | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reload, setReload] = useState(0);
  const [toDelete, setToDelete] = useState<BookingListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim() === debounced) return;
    const t = setTimeout(() => setParams({ q: q.trim() }), 250);
    return () => clearTimeout(t);
  }, [q, debounced, setParams]);

  const query = useCallback(
    (c?: string | null) => {
      const p = new URLSearchParams({ limit: "30" });
      if (tab !== "all") p.set("stage", tab);
      if (debounced) p.set("q", debounced);
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      if (c) p.set("cursor", c);
      return `/api/bookings?${p}`;
    },
    [tab, debounced, from, to],
  );

  const key = `${query()}#${reload}`;
  useEffect(() => {
    let alive = true;
    api<{ items: BookingListItem[]; nextCursor: string | null }>(query())
      .then((r) => alive && setResult({ key, items: r.items, cursor: r.nextCursor, error: null }))
      .catch((e) => alive && setResult({ key, items: [], cursor: null, error: e instanceof ApiClientError ? e.message : "Couldn't load bookings." }));
    return () => {
      alive = false;
    };
  }, [key, query]);
  useEffect(() => {
    let alive = true;
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    api<Counts>(`/api/bookings/summary?${p}`)
      .then((c) => alive && setCounts(c))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [from, to, reload]);

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

  async function doDelete() {
    if (!toDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api(`/api/bookings/${toDelete.id}`, { method: "DELETE" });
      setToDelete(null);
      setReload((n) => n + 1);
    } catch (e) {
      setDeleteError(e instanceof ApiClientError ? e.message : "Couldn't delete. Nothing was removed.");
    } finally {
      setDeleting(false);
    }
  }

  const route = (b: BookingListItem) => {
    const f = b.originCity;
    const t = b.destinationCity ?? b.destinationCountry;
    return f || t ? `${f ?? "?"} → ${t ?? "?"}` : "Route not given yet";
  };
  const detail = (b: BookingListItem) => {
    const stage = stageOf(b);
    if (stage === "completed") return "Sent to the ERP";
    if (stage === "draft") return b.status === "Blocked" ? `Blocked · ${b.redCount} to fix` : "Details missing";
    return b.amberCount ? `${b.amberCount} to check` : "All checks pass";
  };
  const savedId = params.get("saved");
  const savedItem = savedId ? (items ?? []).find((b) => b.id === savedId) : undefined;
  const filtered = Boolean(tab !== "all" || debounced || from || to);
  const actions = (b: BookingListItem, prefix = "") => (
    <span className="flex items-center justify-end gap-1.5">
      <Link href={openHref(b)} className="inline-flex h-8 items-center rounded-full border border-control bg-sheet px-3.5 text-small font-medium text-text hover:bg-raised" data-testid={`${prefix}open-booking`} aria-label={`Open ${bookingId(b)}`}>
        Open
      </Link>
      <button
        type="button"
        onClick={() => {
          setDeleteError(null);
          setToDelete(b);
        }}
        className="inline-flex h-8 items-center rounded-full px-3.5 text-small font-medium text-red-ink hover:bg-red-bg"
        data-testid={`${prefix}delete-booking`}
        aria-label={`Delete ${bookingId(b)}`}
      >
        Delete
      </button>
    </span>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 pt-2 pb-8 lg:px-6">
        <PageHeader
          title="All bookings"
          description="Every booking from your chats and Excel uploads in this browser, most recently active first."
          actions={
            <Link href="/new" className="inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-sm font-medium text-on-primary hover:bg-primary-hover">
              New booking
            </Link>
          }
        />

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Booking stage" className="flex flex-wrap gap-1.5" data-testid="booking-tabs">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setParams({ tab: t.key })}
                data-testid={`tab-${t.key}`}
                className={cx("inline-flex h-9 items-center gap-2 rounded-full px-4 text-small font-medium transition-colors", tab === t.key ? "bg-primary text-on-primary" : "bg-sheet text-muted hover:text-text")}
              >
                {t.label}
                {counts && (
                  <span className={cx("num text-caption", tab === t.key ? "opacity-80" : "text-faint")} data-testid={`tab-count-${t.key}`}>
                    {counts[t.key === "all" ? "all" : t.key]}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <DateRangePicker from={from} to={to} onChange={(a, b) => setParams({ from: a, to: b })} />
            <label className="block w-full sm:w-64">
              <span className="sr-only">Search bookings</span>
              <input name="q" type="search" autoComplete="off" spellCheck={false} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ID, route or seller…" className="h-10 w-full rounded-full bg-sheet px-4 text-small placeholder:text-faint" />
            </label>
          </div>
        </div>

        {savedId && (
          <div className="mt-4" data-testid="saved-notice">
            <Notice action={<button className="underline" onClick={() => setParams({ saved: null })}>Dismiss</button>}>
              Saved. {savedItem ? <><strong className="font-medium">{bookingId(savedItem)}</strong> is under {savedItem.confirmed ? "Completed" : stageOf(savedItem) === "sync" ? "Sync to ERP" : "Drafts"}.</> : "Your booking is in the list below."}
            </Notice>
          </div>
        )}
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
                  <Link href="/new" className="inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-sm font-medium text-on-primary hover:bg-primary-hover">
                    New booking
                  </Link>
                }
              >
                Bookings from chats and Excel uploads show up here.
              </EmptyState>
            ) : (
              <EmptyState title="No bookings match these filters">Try another tab, a wider date range, or clear the search.</EmptyState>
            )}
          </div>
        ) : (
          <div className="mt-4 rounded-3xl bg-sheet p-4 sm:p-6">
            <ul className="divide-y divide-rule sm:hidden" aria-label="Bookings">
              {items.map((b) => (
                <li key={b.id} className="py-3" data-testid="booking-card" data-source={b.source} data-stage={stageOf(b)}>
                  <span className="flex items-start justify-between gap-2">
                    <Link href={`/bookings/${b.id}`} className="min-w-0 truncate text-small font-medium text-text">
                      {bookingId(b)}
                    </Link>
                    <StagePill stage={stageOf(b)} />
                  </span>
                  <span className="num mt-0.5 block truncate text-caption text-muted">
                    {route(b)} · {relativeTime(b.lastActivityAt)}
                  </span>
                  <span className="mt-2 block">{actions(b, "card-")}</span>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[720px] text-small" data-testid="bookings-table">
                <thead>
                  <tr className="text-left text-caption text-muted">
                    <th className="py-2 pr-3 font-medium">Booking ID</th>
                    <th className="py-2 pr-3 font-medium">Route</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Updated</th>
                    <th className="py-2 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((b) => (
                    <tr key={b.id} className="border-t border-rule hover:bg-raised" data-testid="booking-row" data-source={b.source} data-stage={stageOf(b)}>
                      <td className="py-3 pr-3">
                        <Link href={`/bookings/${b.id}`} className="font-medium text-text hover:underline" data-testid="booking-id">
                          {bookingId(b)}
                        </Link>
                        <span className="block text-caption text-muted">
                          {b.sellerName ?? "Seller not given yet"} · {b.source === "chat" ? "Chat" : "Excel"}
                        </span>
                      </td>
                      <td className="py-3 pr-3 text-text">{route(b)}</td>
                      <td className="py-3 pr-3">
                        <StagePill stage={stageOf(b)} />
                        <span className="mt-1 block text-caption text-muted">{detail(b)}</span>
                      </td>
                      <td className="py-3 pr-3 text-muted">
                        <time dateTime={b.lastActivityAt}>{relativeTime(b.lastActivityAt)}</time>
                      </td>
                      <td className="py-3">{actions(b)}</td>
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

      <ConfirmDialog
        open={Boolean(toDelete)}
        title="Delete this booking?"
        body={
          <>
            <p>
              <strong className="font-medium text-text">{toDelete ? bookingId(toDelete) : ""}</strong>
              {toDelete?.source === "chat" ? ", its conversation" : ""} and its revision history will be permanently deleted. Other bookings are not affected.
            </p>
            {deleteError && <p className="mt-2 text-red-ink">{deleteError}</p>}
          </>
        }
        confirmLabel="Delete booking"
        danger
        busy={deleting}
        onCancel={() => setToDelete(null)}
        onConfirm={() => void doDelete()}
      />
    </div>
  );
}
