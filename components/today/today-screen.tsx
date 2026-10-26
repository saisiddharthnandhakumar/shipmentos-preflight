"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import type { BookingListItem, BookingSnapshot } from "@/lib/client/types";
import { useHistory } from "../shell/history-context";
import { Button, Card, Chip, EmptyState, Figure, Glyph, Notice, PageHeader, Skeleton, Stat, StatusPill, relativeTime } from "../ui";

export const SAMPLED_KEY = "shipmentos.sampled";
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
  const history = useHistory();
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

  const [seeding, setSeeding] = useState(false);
  async function loadSample() {
    setSeeding(true);
    try {
      await api("/api/sample", { method: "POST" });
      void history.refreshChats();
      setData(null);
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
    if (!data || seeded.current || history.sessionReady === false) return;
    const count = STATUSES.reduce((n, st) => n + data[st].items.length, 0);
    let done = false;
    try {
      done = localStorage.getItem(SAMPLED_KEY) === "1";
    } catch {
      /* storage unavailable: treat as not yet loaded, once per page view */
    }
    if (count >= 6 || done) return;
    seeded.current = true;
    try {
      localStorage.setItem(SAMPLED_KEY, "1");
    } catch {
      /* ignore */
    }
    void loadSample();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const total = data ? STATUSES.reduce((n, s) => n + data[s].items.length, 0) : 0;
  const attention = data ? [...data.Blocked.items, ...data["Needs attention"].items].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)) : [];

  // Client-only: the server render has no date, so it never mismatches.
  const today = useSyncExternalStore(
    () => () => {},
    () => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date()),
    () => "",
  );

  const share = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const mix = data
    ? ([
        { key: "Blocked", n: data.Blocked.items.length, bar: "bg-ink", dot: "bg-ink" },
        { key: "Needs attention", n: data["Needs attention"].items.length, bar: "bg-lavender", dot: "bg-lavender" },
        { key: "Ready to submit", n: data["Ready to submit"].items.length, bar: "bg-accent", dot: "bg-accent" },
        { key: "Draft", n: data.Draft.items.length, bar: "bg-faint", dot: "bg-faint" },
      ] as const)
    : [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 px-4 pt-2 pb-8 lg:px-6">
        <PageHeader
          title="Today"
          description="What needs your attention before a booking can go to the carrier."
          actions={
            <>
              {today && <span className="hidden text-small text-muted sm:inline">{today}</span>}
              {data && total > 0 && total < 6 && (
                <button
                  type="button"
                  onClick={() => void loadSample()}
                  disabled={seeding}
                  className="inline-flex h-10 items-center rounded-full border-2 border-dashed border-control px-5 text-sm font-medium text-text transition-colors hover:bg-sheet disabled:opacity-55"
                >
                  {seeding ? "Loading…" : "Load sample data"}
                </button>
              )}
              <Link href="/upload" className="inline-flex h-10 items-center rounded-full bg-sheet px-5 text-sm font-medium text-text transition-colors hover:bg-raised">
                Upload Excel
              </Link>
              <Link href="/chat?new=today" className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover">
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
          <div className="grid gap-4 lg:grid-cols-3" aria-label="Loading your bookings">
            <Skeleton className="h-96 rounded-3xl lg:row-span-2" />
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-44 rounded-3xl" />
            ))}
          </div>
        ) : total === 0 ? (
          <EmptyState
            title="No bookings yet"
            actions={
              <>
                <Link href="/chat?new=today" className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-medium text-on-primary hover:bg-primary-hover">
                  Describe a shipment
                </Link>
                <Link href="/upload" className="inline-flex h-10 items-center rounded-full border border-control bg-sheet px-5 text-sm font-medium text-text hover:bg-raised">
                  Upload a spreadsheet
                </Link>
                <Button variant="ghost" onClick={() => void loadSample()} disabled={seeding}>
                  {seeding ? "Loading…" : "Load sample data"}
                </Button>
              </>
            }
          >
            Tell the assistant about a UK to EU pallet shipment, or upload a workbook of bookings. Every booking is checked against ten rules, and nothing is sent to a carrier.
          </EmptyState>
        ) : (
          <>
            <section aria-label="Booking totals" className="grid gap-4 lg:grid-cols-3">
              <Card
                title="Booking mix"
                className="lg:row-span-2"
                icon={<svg viewBox="0 0 16 16" className="size-4" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="8" r="4" /><circle cx="10.5" cy="8" r="3" /></svg>}
              >
                <Figure value={total} unit="bookings in this browser" size="display" />
                <MixBubbles blocked={mix[0].n} attention={mix[1].n} ready={mix[2].n} />
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
              <Stat label="Blocked" value={countLabel(data.Blocked)} unit="bookings" tone="red" glyph="red" href="/bookings?status=Blocked" hint="Must be fixed first" chip={<Chip tone="dark">{share(mix[0].n)}%</Chip>} />
              <Stat label="Needs attention" value={countLabel(data["Needs attention"])} unit="bookings" tone="amber" glyph="amber" href="/bookings?status=Needs%20attention" hint="Worth a check" chip={<Chip tone="lavender">{share(mix[1].n)}%</Chip>} />
              <Stat label="Ready to submit" value={countLabel(data["Ready to submit"])} unit="bookings" tone="pass" glyph="pass" href="/bookings?status=Ready%20to%20submit" hint="Nothing left to fix" chip={<Chip>{share(mix[2].n)}%</Chip>} />
              <Stat label="Draft" value={countLabel(data.Draft)} unit="bookings" tone="na" glyph="na" href="/bookings?status=Draft" hint="Still being filled in" />
            </section>

            <Card
              tone="dark"
              title="Needs your attention"
              icon={<Glyph kind="red" className="size-4 text-red-ink" />}
              action={attention.length > 0 ? <Link href="/bookings?status=Blocked" className="text-small font-medium text-accent-ink hover:underline">See all</Link> : undefined}
            >
              {attention.length === 0 ? (
                <p className="rounded-2xl bg-pass-bg px-4 py-3 text-sm text-pass-ink">Nothing is blocked and nothing needs a check. You&apos;re up to date.</p>
              ) : (
                <ul className="-mx-2 divide-y divide-rule" data-testid="attention-list">
                  {attention.slice(0, 8).map((b, i) => (
                    <AttentionRow key={b.id} b={b} loadFix={i < 5} />
                  ))}
                </ul>
              )}
            </Card>

            {data["Ready to submit"].items.length > 0 && (
              <Card title="Ready to submit" icon={<Glyph kind="pass" className="size-4 text-pass-ink" />}>
                <ul className="-mx-2 divide-y divide-rule">
                  {data["Ready to submit"].items.slice(0, 5).map((b) => (
                    <li key={b.id}>
                      <Link href={`/bookings/${b.id}`} className="flex items-center gap-3 rounded-2xl px-2 py-3 transition-colors hover:bg-raised">
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
              </Card>
            )}
          </>
        )}
        {data && total > 0 && (
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

/** Three overlapping circles, area proportional to the count: black blocked, lavender needs attention, lime ready. */
function MixBubbles({ blocked, attention, ready }: { blocked: number; attention: number; ready: number }) {
  const max = Math.max(blocked, attention, ready, 1);
  const r = (n: number) => 26 + 62 * Math.sqrt(n / max);
  const rb = r(blocked);
  const ra = r(attention);
  const rr = r(ready);
  return (
    <svg viewBox="0 0 320 250" className="mt-4 w-full" role="img" aria-label={`${blocked} blocked, ${attention} needs attention, ${ready} ready to submit`}>
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
      <Link href={`/bookings/${b.id}`} className="block rounded-2xl px-2 py-3.5 transition-colors hover:bg-active">
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
          {b.redCount + b.amberCount > 0 ? `${b.redCount} to fix · ${b.amberCount} to check · ` : "Input problem · "}
          {relativeTime(b.lastActivityAt)}
        </span>
      </Link>
    </li>
  );
}
