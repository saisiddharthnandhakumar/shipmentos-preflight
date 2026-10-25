"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import type { BookingListItem } from "@/lib/client/types";
import { BookingDetail } from "../booking/booking-detail";
import { Button, Drawer, Notice, Skeleton, StatusPill, cx, relativeTime } from "../ui";

type Summary = {
  total: number;
  ready: number;
  needsAttention: number;
  blocked: number;
  bookingsWithInputIssues: number;
  inputErrors: number;
  inputWarnings: number;
  ruleFailures: Record<string, number>;
  skippedExampleRows: { sheet: string; row: number }[];
  headerRows: { Bookings: number | null; Items: number | null };
  itemRows: number;
};
type BatchListItem = { id: string; filename: string; bookingRowCount: number; status: string; summary: Summary; createdAt: string };
type Issue = { id: string; bookingId: string | null; sheet: string; row: number | null; column: string | null; code: string; severity: string; message: string; rawValue: string | null };
type BatchDetail = { batch: { id: string; filename: string; status: string; summary: Summary; createdAt: string; itemRowCount: number; bookingRowCount: number }; issues: Issue[]; bookings: BookingListItem[] };

export function UploadStart() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [batches, setBatches] = useState<BatchListItem[] | null>(null);
  const [batchesError, setBatchesError] = useState<string | null>(null);

  const loadBatches = useCallback(() => {
    api<{ batches: BatchListItem[] }>("/api/imports")
      .then((r) => setBatches(r.batches))
      .catch((e) => setBatchesError(e instanceof ApiClientError ? e.message : "Couldn't load previous uploads."));
  }, []);
  useEffect(loadBatches, [loadBatches]);

  async function send(file: File) {
    setError(null);
    if (!/\.xlsx$/i.test(file.name)) return setError("Choose an .xlsx workbook (Excel 2007 or later).");
    if (file.size > 4 * 1024 * 1024) return setError("That file is larger than 4 MB.");
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await api<{ batchId: string }>("/api/import", { method: "POST", form });
      router.push(`/upload/${r.batchId}`);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Upload failed. Nothing was saved; please retry.");
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[960px] px-4 py-6 lg:px-8 lg:py-8">
        <h1 className="text-2xl font-semibold tracking-[-0.01em] text-text">Upload Excel</h1>
        <p className="mt-1 max-w-[640px] text-sm text-muted">
          Check every booking in a workbook against the 10 pre-flight rules. Use the template&apos;s <span className="font-medium text-text">Bookings</span> and{" "}
          <span className="font-medium text-text">Items</span> sheets; carrier rates and the rulebook are already built in. No AI is used for uploads.
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files[0];
            if (f) void send(f);
          }}
          className={cx(
            "mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center",
            drag ? "border-accent bg-accent-soft" : "border-control bg-raised",
          )}
        >
          <svg viewBox="0 0 40 40" className="size-10 text-muted" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="8" y="5" width="24" height="30" rx="3" />
            <path d="M13 13h14M13 18h14M13 23h9M20 28v-8m-3 3 3-3 3 3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="mt-3 text-[15px] font-medium text-text">{busy ? "Checking your bookings…" : "Drop your .xlsx here"}</p>
          <p className="mt-1 text-[13px] text-muted">Up to 4 MB · 2,000 bookings · 10,000 item rows</p>
          <input
            ref={input}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            id="xlsx-input"
            data-testid="xlsx-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void send(f);
              e.target.value = "";
            }}
          />
          <Button variant="primary" className="mt-4" onClick={() => input.current?.click()} disabled={busy}>
            {busy ? "Uploading…" : "Choose file"}
          </Button>
        </div>
        {error && (
          <div className="mt-3">
            <Notice tone="error">{error}</Notice>
          </div>
        )}

        <section className="mt-10" aria-labelledby="prev-uploads">
          <h2 id="prev-uploads" className="text-[15px] font-semibold text-text">
            Previous uploads in this browser
          </h2>
          {batchesError ? (
            <p className="mt-2 text-[13px] text-red-ink">{batchesError}</p>
          ) : batches === null ? (
            <div className="mt-3 space-y-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : batches.length === 0 ? (
            <p className="mt-2 rounded-lg border border-dashed border-control px-3 py-2.5 text-[13px] text-muted">No uploads yet. Results you upload stay here for 7 days.</p>
          ) : (
            <ul className="mt-2 divide-y divide-rule">
              {batches.map((b) => (
                <li key={b.id}>
                  <Link href={`/upload/${b.id}`} className="flex items-center gap-3 py-2.5 hover:bg-raised">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text">{b.filename}</span>
                    <span className="num hidden text-[12px] text-muted sm:inline">
                      {b.summary.total} bookings · {b.summary.blocked} blocked · {b.summary.needsAttention} attention · {b.summary.ready} ready
                    </span>
                    <time className="flex-none text-[12px] text-muted" dateTime={b.createdAt}>
                      {relativeTime(b.createdAt)}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

type Filter = "all" | "Blocked" | "Needs attention" | "Ready to submit" | "issues";

export function UploadResults({ batchId }: { batchId: string }) {
  const [data, setData] = useState<BatchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const FILTERS: Filter[] = ["all", "Blocked", "Needs attention", "Ready to submit", "issues"];
  const filter: Filter = FILTERS.includes(params.get("status") as Filter) ? (params.get("status") as Filter) : "all";
  const setFilter = (f: Filter) => {
    const next = new URLSearchParams(params.toString());
    if (f === "all") next.delete("status");
    else next.set("status", f);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    api<BatchDetail>(`/api/imports/${batchId}`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : "Couldn't load this upload."));
  }, [batchId]);
  useEffect(load, [load]);

  const withIssues = useMemo(() => new Set(data?.issues.filter((i) => i.severity === "error" && i.bookingId).map((i) => i.bookingId!) ?? []), [data]);
  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.bookings.filter((b) => {
      if (filter === "issues" ? !withIssues.has(b.id) : filter !== "all" && b.status !== filter) return false;
      if (!needle) return true;
      return [b.externalBookingId, b.sellerName, b.title, b.destinationCountry, b.status].some((v) => v?.toLowerCase().includes(needle));
    });
  }, [data, filter, q, withIssues]);

  if (error)
    return (
      <div className="p-6">
        <Notice tone="error" action={<button className="underline" onClick={() => { setError(null); load(); }}>Retry</button>}>
          {error}
        </Notice>
      </div>
    );
  if (!data)
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-16" />
        <Skeleton className="h-64" />
      </div>
    );

  const s = data.batch.summary;
  const counts: { key: Filter; label: string; value: number }[] = [
    { key: "all", label: "All bookings", value: s.total },
    { key: "Blocked", label: "Blocked", value: s.blocked },
    { key: "Needs attention", label: "Needs attention", value: s.needsAttention },
    { key: "Ready to submit", label: "Ready to submit", value: s.ready },
    { key: "issues", label: "With input issues", value: s.bookingsWithInputIssues },
  ];
  const workbookIssues = data.issues.filter((i) => !i.bookingId);
  const topRules = Object.entries(s.ruleFailures).sort((a, b) => b[1] - a[1]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-[-0.01em] text-text" data-testid="upload-title">
              {data.batch.filename}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {s.total} bookings and {s.itemRows} item rows checked {relativeTime(data.batch.createdAt).toLowerCase()}.
              {topRules.length ? ` Most common: ${topRules.slice(0, 3).map(([r, n]) => `${r} (${n})`).join(", ")}.` : " No rule failures."}
            </p>
          </div>
          <Link href="/upload" className="inline-flex h-9 flex-none items-center rounded-lg border border-control bg-white px-3.5 text-sm font-medium hover:bg-raised">
            Upload another
          </Link>
        </div>

        <div role="group" aria-label="Filter by status" className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="upload-summary">
          {counts.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={filter === c.key}
              onClick={() => setFilter(c.key)}
              className={cx(
                "rounded-lg border px-3 py-2.5 text-left",
                filter === c.key ? "border-accent bg-accent-soft" : "border-border bg-white hover:bg-raised",
                c.key === "issues" && counts.length % 2 === 1 && "col-span-2 sm:col-span-1",
              )}
            >
              <span className="block text-[12px] text-muted">{c.label}</span>
              <span className="num mt-0.5 block text-base font-semibold text-text" data-testid={`count-${c.key}`}>
                {c.value}
              </span>
            </button>
          ))}
        </div>

        {(s.skippedExampleRows.length > 0 || workbookIssues.length > 0) && (
          <section className="mt-5 space-y-1.5" aria-label="Workbook notes">
            {workbookIssues.filter((i) => i.severity !== "info").map((i) => (
              <Notice key={i.id} tone={i.severity === "error" ? "error" : "warn"}>
                <span className="font-medium">{i.sheet}{i.row ? ` row ${i.row}` : ""}: </span>
                {i.message}
              </Notice>
            ))}
            {workbookIssues.filter((i) => i.severity === "info").map((i) => (
              <Notice key={i.id}>{i.message}</Notice>
            ))}
          </section>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-text">
            Bookings <span className="num font-normal text-muted">{rows.length} shown</span>
          </h2>
          <label className="relative block w-full sm:w-72">
            <span className="sr-only">Search bookings</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              name="q"
              type="search"
              autoComplete="off"
              spellCheck={false}
              placeholder="Search ID, seller, country, status…"
              className="h-9 w-full rounded-lg border border-control bg-white px-3 text-[13px] placeholder:text-faint"
              data-testid="upload-search"
            />
          </label>
        </div>

        <ul className="mt-2 divide-y divide-rule sm:hidden" aria-label="Bookings">
          {rows.length === 0 ? (
            <li className="py-4 text-center text-[13px] text-muted">No bookings match this filter.</li>
          ) : (
            rows.map((b) => (
              <li key={b.id}>
                <button type="button" className="block w-full py-2.5 text-left" onClick={() => setOpen(b.id)}>
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0 truncate text-[13px] text-text">
                      <span className="font-mono">{b.externalBookingId ?? "—"}</span> {b.title.replace(/^[^·]*·\s*/, "")}
                    </span>
                    <StatusPill status={b.status} />
                  </span>
                  <span className="num mt-0.5 block truncate text-[12px] text-muted">
                    {b.sellerName ?? "—"} · {b.redCount} Red · {b.amberCount} Amber{withIssues.has(b.id) ? " · input issue" : ""}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="mt-2 hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[720px] text-[13px]" data-testid="results-table">
            <thead>
              <tr className="text-left text-[12px] text-muted">
                <th className="py-2 pr-3 font-normal">Booking</th>
                <th className="py-2 pr-3 font-normal">Route</th>
                <th className="py-2 pr-3 font-normal">Status</th>
                <th className="py-2 pr-3 text-right font-normal">Red</th>
                <th className="py-2 pr-3 text-right font-normal">Amber</th>
                <th className="py-2 font-normal">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-muted">
                    No bookings match this filter.
                  </td>
                </tr>
              ) : (
                rows.map((b) => (
                  <tr key={b.id} className="cursor-pointer border-t border-rule hover:bg-raised" onClick={() => setOpen(b.id)} data-testid="result-row" data-external-id={b.externalBookingId ?? ""}>
                    <td className="py-2.5 pr-3">
                      <span className="font-mono text-text">{b.externalBookingId ?? "—"}</span>
                      <span className="block max-w-[220px] truncate text-[12px] text-muted">{b.sellerName ?? "—"}</span>
                    </td>
                    <td className="py-2.5 pr-3 text-text">{b.title.replace(/^[^·]*·\s*/, "")}</td>
                    <td className="py-2.5 pr-3">
                      <span className="flex items-center gap-1.5">
                        <StatusPill status={b.status} />
                        {withIssues.has(b.id) && <span className="text-[11px] text-red-ink">input issue</span>}
                      </span>
                    </td>
                    <td className={cx("num py-2.5 pr-3 text-right", b.redCount ? "font-medium text-red-ink" : "text-muted")}>{b.redCount}</td>
                    <td className={cx("num py-2.5 pr-3 text-right", b.amberCount ? "font-medium text-amber-ink" : "text-muted")}>{b.amberCount}</td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        className="text-[13px] font-medium text-accent hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpen(b.id);
                        }}
                        aria-label={`Open details for ${b.externalBookingId ?? b.title}`}
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <Drawer open={Boolean(open)} onClose={() => setOpen(null)} label="Booking details">
        {open && <BookingDetail bookingId={open} onClose={() => setOpen(null)} />}
      </Drawer>
    </div>
  );
}
