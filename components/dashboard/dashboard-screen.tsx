"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import type { BookingListItem, BookingSnapshot } from "@/lib/client/types";
import { isISODate } from "@/lib/domain/stage";
import { bookingId, openHref } from "../bookings/bookings-history";
import { DateRangePicker } from "../date-range-picker";
import { useHistory } from "../shell/history-context";
import { Button, Card, Chip, EmptyState, Figure, Glyph, Notice, PageHeader, Skeleton, Stat, StagePill, relativeTime } from "../ui";

export const SAMPLED_KEY = "shipmentos.sampled";
type Counts = { all: number; completed: number; sync: number; draft: number };

export function DashboardScreen() {
  const history = useHistory();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const from = isISODate(params.get("from")) ? params.get("from") : null;
  const to = isISODate(params.get("to")) ? params.get("to") : null;
  const ranged = Boolean(from || to);
  const setRange = useCallback(
    (a: string | null, b: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (a) next.set("from", a);
      else next.delete("from");
      if (b) next.set("to", b);
      else next.delete("to");
      router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const [counts, setCounts] = useState<Counts | null>(null);
  /** Everything in this browser, ignoring the date range: decides between "no bookings yet" and "none in this range". */
  const [overall, setOverall] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<BookingListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    const d = new URLSearchParams({ limit: "8", stage: "draft" });
    if (from) d.set("from", from);
    if (to) d.set("to", to);
    Promise.all([
      api<Counts>(`/api/bookings/summary?${p}`),
      ranged ? api<Counts>("/api/bookings/summary") : null,
      api<{ items: BookingListItem[] }>(`/api/bookings?${d}`),
    ])
      .then(([c, all, list]) => {
        if (!alive) return;
        setCounts(c);
        setOverall((all ?? c).all);
        setDrafts(list.items);
        setError(null);
      })
      .catch((e) => alive && setError(e instanceof ApiClientError ? e.message : "Couldn't load your bookings."));
    return () => {
      alive = false;
    };
  }, [reload, from, to, ranged]);

  const [seeding, setSeeding] = useState(false);
  async function loadSample() {
    setSeeding(true);
    try {
      await api("/api/sample", { method: "POST" });
      setCounts(null);
      setReload((n) => n + 1);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load the sample data.");
    } finally {
      setSeeding(false);
    }
  }

  // Demo app: a browser that has barely any bookings gets the sample set once, so every screen has data.
  // The flag stops it coming back after the user deletes data; "Reset my data" clears the flag.
  const seeded = useRef(false);
  useEffect(() => {
    if (overall === null || seeded.current || history.sessionReady === false) return;
    let done = false;
    try {
      done = localStorage.getItem(SAMPLED_KEY) === "1";
    } catch {
      /* storage unavailable: treat as not yet loaded, once per page view */
    }
    if (overall >= 6 || done) return;
    seeded.current = true;
    try {
      localStorage.setItem(SAMPLED_KEY, "1");
    } catch {
      /* ignore */
    }
    void loadSample();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overall]);

  const total = counts?.all ?? 0;

  // Client-only: the server render has no date, so it never mismatches.
  const today = useSyncExternalStore(
    () => () => {},
    () => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date()),
    () => "",
  );

  const share = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const rangeQuery = `${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`;
  const mix = counts
    ? ([
        { key: "Completed", n: counts.completed, bar: "bg-accent", dot: "bg-accent" },
        { key: "Sync to ERP", n: counts.sync, bar: "bg-lavender", dot: "bg-lavender" },
        { key: "Drafts", n: counts.draft, bar: "bg-ink", dot: "bg-ink" },
      ] as const)
    : [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 px-4 pt-2 pb-8 lg:px-6">
        <PageHeader
          title="Dashboard"
          description="Where every booking stands, and what still needs finishing."
          actions={
            <>
              {today && !ranged && <span className="hidden text-small text-muted sm:inline">{today}</span>}
              {counts && overall !== null && overall > 0 && overall < 6 && (
                <button
                  type="button"
                  onClick={() => void loadSample()}
                  disabled={seeding}
                  className="inline-flex h-10 items-center rounded-full border-2 border-dashed border-control px-5 text-sm font-medium text-text transition-colors hover:bg-sheet disabled:opacity-55"
                >
                  {seeding ? "Loading…" : "Load sample data"}
                </button>
              )}
              <DateRangePicker from={from} to={to} onChange={setRange} />
            </>
          }
        />

        {error ? (
          <Notice tone="error" action={<button className="underline" onClick={() => { setCounts(null); setReload((n) => n + 1); }}>Retry</button>}>
            {error}
          </Notice>
        ) : !counts || !drafts ? (
          <div className="grid gap-4 lg:grid-cols-3" aria-label="Loading your bookings">
            <Skeleton className="h-96 rounded-3xl lg:row-span-2" />
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-44 rounded-3xl" />
            ))}
          </div>
        ) : overall === 0 ? (
          <EmptyState
            title="No bookings yet"
            actions={
              <>
                <Link href="/new" className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-medium text-on-primary hover:bg-primary-hover">
                  New booking
                </Link>
                <Button variant="ghost" onClick={() => void loadSample()} disabled={seeding}>
                  {seeding ? "Loading…" : "Load sample data"}
                </Button>
              </>
            }
          >
            Tell the assistant about a UK to EU pallet shipment, fill in a form, or upload a workbook of bookings. Every booking is checked against ten rules, and nothing is sent to a carrier.
          </EmptyState>
        ) : (
          <>
            {ranged && total === 0 && <Notice>No bookings were updated in this date range. Pick another range, or clear it to see everything.</Notice>}
            <section aria-label="Booking totals" className="grid gap-4 lg:grid-cols-3" data-testid="dashboard-stats">
              <Card
                title="Booking mix"
                className="lg:row-span-2"
                icon={<svg viewBox="0 0 16 16" className="size-4" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="8" r="4" /><circle cx="10.5" cy="8" r="3" /></svg>}
              >
                <Figure value={total} unit={ranged ? "bookings in this range" : "bookings in this browser"} size="display" />
                <MixBubbles completed={counts.completed} sync={counts.sync} drafts={counts.draft} />
                <ul className="mt-5 space-y-4">
                  {mix.map((m) => (
                    <li key={m.key}>
                      <div className="flex items-end justify-between gap-3">
                        <Figure value={share(m.n)} unit="%" />
                        <span className="flex items-center gap-1.5 pb-1 text-small text-muted">
                          {m.key}
                          <span aria-hidden className={`size-2 rounded-full ${m.dot}`} />
                        </span>
                      </div>
                      <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-raised" role="presentation">
                        <div className={`h-full rounded-full ${m.bar}`} style={{ width: `${share(m.n)}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
              <Stat label="All" value={counts.all} unit="bookings" tone="na" href={`/bookings?tab=all${rangeQuery}`} hint="Every booking" />
              <Stat label="Completed" value={counts.completed} unit="bookings" tone="pass" glyph="pass" href={`/bookings?tab=completed${rangeQuery}`} hint="Sent to the ERP" chip={<Chip>{share(counts.completed)}%</Chip>} />
              <Stat label="Sync to ERP" value={counts.sync} unit="bookings" tone="amber" glyph="amber" href={`/bookings?tab=sync${rangeQuery}`} hint="Ready, not sent yet" chip={<Chip tone="lavender">{share(counts.sync)}%</Chip>} />
              <Stat label="Drafts" value={counts.draft} unit="bookings" tone="na" glyph="na" href={`/bookings?tab=draft${rangeQuery}`} hint="Still being filled in or fixed" chip={<Chip tone="dark">{share(counts.draft)}%</Chip>} />
            </section>

            <Card
              tone="dark"
              title="Needs your attention"
              icon={<Glyph kind="red" className="size-4 text-red-ink" />}
              action={counts.draft > 0 ? <Link href={`/bookings?tab=draft${rangeQuery}`} className="text-small font-medium text-accent-ink hover:underline">See all drafts</Link> : undefined}
            >
              {drafts.length === 0 ? (
                <p className="rounded-2xl bg-pass-bg px-4 py-3 text-sm text-pass-ink">No drafts waiting. Everything is either ready to sync or already in the ERP.</p>
              ) : (
                <ul className="-mx-2 divide-y divide-rule" data-testid="attention-list">
                  {drafts.map((b, i) => (
                    <AttentionRow key={b.id} b={b} loadFix={i < 5} />
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
        {counts && overall !== null && overall > 0 && (
          <p className="text-caption text-muted">
            Bookings are kept in this browser for 7 days.{" "}
            <button type="button" className="underline underline-offset-2 hover:text-text" onClick={() => void loadSample()} disabled={seeding}>
              {seeding ? "Loading sample data…" : "Load sample data"}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

/** Three overlapping circles, area proportional to the count: black drafts, lavender sync to ERP, lime completed. */
function MixBubbles({ completed, sync, drafts }: { completed: number; sync: number; drafts: number }) {
  const blocked = drafts;
  const attention = sync;
  const ready = completed;
  const max = Math.max(blocked, attention, ready, 1);
  const r = (n: number) => 26 + 62 * Math.sqrt(n / max);
  const rb = r(blocked);
  const ra = r(attention);
  const rr = r(ready);
  return (
    <svg viewBox="0 0 320 250" className="mt-4 w-full" role="img" aria-label={`${drafts} drafts, ${sync} to sync to the ERP, ${completed} completed`}>
      <circle cx={100} cy={105} r={ra} fill="var(--lavender)" />
      <circle cx={222} cy={100} r={rb} fill="#1c1c1c" stroke="var(--sheet)" strokeWidth="3" />
      <circle cx={168} cy={178} r={rr} fill="var(--accent)" stroke="var(--sheet)" strokeWidth="3" />
      {[
        { x: 100, y: 105, n: attention, c: "#1c1c1c" },
        { x: 222, y: 100, n: blocked, c: "#ffffff" },
        { x: 168, y: 178, n: ready, c: "#1c1c1c" },
      ].map((t) => (
        <g key={t.x} fill={t.c} textAnchor="middle">
          <text x={t.x} y={t.y + 6} fontSize="26" fontWeight="500" style={{ fontFamily: "var(--font-display)", letterSpacing: "-0.03em" }}>
            {t.n}
          </text>
          <text x={t.x} y={t.y + 22} fontSize="11" opacity="0.7">
            bookings
          </text>
        </g>
      ))}
    </svg>
  );
}

/** One draft that needs work: what it is, what is holding it back, and the first thing to do. */
function AttentionRow({ b, loadFix }: { b: BookingListItem; loadFix: boolean }) {
  const [fix, setFix] = useState<{ lead: string; text: string } | null>(null);
  useEffect(() => {
    if (!loadFix) return;
    let alive = true;
    api<BookingSnapshot>(`/api/bookings/${b.id}`)
      .then((s) => {
        if (!alive) return;
        const failing = s.evaluation.rules.filter((r) => r.status === "fail");
        const first = failing.sort((a, b) => (a.severity === b.severity ? a.ruleId.localeCompare(b.ruleId) : a.severity === "Red" ? -1 : 1))[0];
        const f = first?.findings[0];
        const missing = s.evaluation.missingFields;
        if (f) setFix({ lead: "To fix: ", text: f.fix });
        else if (missing.length) setFix({ lead: "Still needed: ", text: `${missing.slice(0, 3).map((m) => m.label).join(", ")}${missing.length > 3 ? ` and ${missing.length - 3} more` : ""}` });
        else setFix({ lead: "", text: s.evaluation.nextSteps[0] ?? s.evaluation.headline });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [b.id, loadFix]);
  const to = b.destinationCity ?? b.destinationCountry;
  const route = b.originCity || to ? `${b.originCity ?? "?"} → ${to ?? "?"}` : "Route not given yet";
  return (
    <li>
      <Link href={openHref(b)} className="block rounded-2xl px-2 py-3.5 transition-colors hover:bg-active" data-testid="attention-row">
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block truncate text-small font-medium text-text">
              {bookingId(b)} · {route}
            </span>
            <span className="block truncate text-caption text-muted">
              {b.sellerName ?? "Seller not given"} · {b.source === "chat" ? "Chat" : "Excel"}
            </span>
          </span>
          <StagePill stage="draft" />
        </span>
        {fix ? (
          <span className="mt-1.5 line-clamp-2 block text-small text-text">
            {fix.lead && <span className="font-medium">{fix.lead}</span>}
            {fix.text}
          </span>
        ) : loadFix ? (
          <Skeleton className="mt-2 h-4 w-2/3" />
        ) : null}
        <span className="num mt-1.5 block text-caption text-muted">
          {b.status === "Blocked" ? `Blocked · ${b.redCount} to fix · ` : "Details missing · "}
          {relativeTime(b.lastActivityAt)}
        </span>
      </Link>
    </li>
  );
}
