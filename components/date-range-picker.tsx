"use client";

import { useEffect, useId, useRef, useState } from "react";
import { addDays, todayUK } from "@/lib/domain/dates";
import { cx } from "./ui";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parts = (v: string) => ({ y: Number(v.slice(0, 4)), m: Number(v.slice(5, 7)) - 1, d: Number(v.slice(8, 10)) });
const pretty = (v: string, withYear: boolean) => {
  const { y, m, d } = parts(v);
  return `${d} ${SHORT[m]}${withYear ? ` ${y}` : ""}`;
};

/** "Any date", "26 Oct 2026" or "20 Oct – 26 Oct 2026". */
export function describeRange(from: string | null, to: string | null): string {
  if (!from && !to) return "Any date";
  const a = from ?? to!;
  const b = to ?? from!;
  if (a === b) return pretty(a, true);
  return `${pretty(a, a.slice(0, 4) !== b.slice(0, 4))} – ${pretty(b, true)}`;
}

/**
 * Calendar popover for one day or a range. Click a day to filter to it; click a second day to stretch it
 * into a range. Dates are plain YYYY-MM-DD (London calendar days), so there are no timezone surprises.
 */
export function DateRangePicker({ from, to, onChange, label = "Updated" }: { from: string | null; to: string | null; onChange: (from: string | null, to: string | null) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const { y, m } = parts(from ?? todayUK());
    return { y, m };
  });
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const active = Boolean(from || to);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  function pick(day: string) {
    if (!anchor) {
      setAnchor(day);
      onChange(day, day);
      return;
    }
    const [a, b] = anchor <= day ? [anchor, day] : [day, anchor];
    setAnchor(null);
    setHover(null);
    onChange(a, b);
    setOpen(false);
  }
  function preset(a: string, b: string) {
    setAnchor(null);
    onChange(a, b);
    const { y, m } = parts(a);
    setView({ y, m });
    setOpen(false);
  }
  const shift = (delta: number) => setView(({ y, m }) => ({ y: y + Math.floor((m + delta) / 12), m: (((m + delta) % 12) + 12) % 12 }));

  const today = todayUK();
  const first = new Date(Date.UTC(view.y, view.m, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const days = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => iso(view.y, view.m, i + 1))];
  // While choosing the second day, preview the range under the pointer.
  const [lo, hi] = anchor && hover ? (anchor <= hover ? [anchor, hover] : [hover, anchor]) : [from, to];

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        data-testid="date-filter"
        className={cx("inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors", active ? "bg-accent text-on-accent" : "bg-sheet text-text hover:bg-raised")}
      >
        <svg viewBox="0 0 16 16" className="size-4" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2.5" y="3.5" width="11" height="10" rx="2" />
          <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
        </svg>
        <span className="text-muted">{label}:</span>
        <span data-testid="date-filter-value">{describeRange(from, to)}</span>
      </button>
      {open && (
        <div id={id} role="dialog" aria-label="Choose dates" className="absolute right-0 z-30 mt-2 w-[min(320px,calc(100vw-32px))] rounded-3xl border border-border bg-sheet p-4 text-text shadow-[0_12px_40px_rgba(0,0,0,0.25)]">
          <div className="flex flex-wrap gap-1.5">
            {[
              ["Today", today, today],
              ["Last 7 days", addDays(today, -6), today],
              ["Last 30 days", addDays(today, -29), today],
            ].map(([l, a, b]) => (
              <button key={l} type="button" onClick={() => preset(a, b)} className="h-8 rounded-full bg-raised px-3 text-small hover:bg-active">
                {l}
              </button>
            ))}
            <button type="button" onClick={() => { setAnchor(null); onChange(null, null); setOpen(false); }} className="h-8 rounded-full px-3 text-small text-muted hover:bg-active hover:text-text" disabled={!active}>
              Clear
            </button>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className="grid size-8 place-items-center rounded-full hover:bg-active">
              ‹
            </button>
            <p className="text-small font-semibold" aria-live="polite">
              {MONTHS[view.m]} {view.y}
            </p>
            <button type="button" onClick={() => shift(1)} aria-label="Next month" className="grid size-8 place-items-center rounded-full hover:bg-active">
              ›
            </button>
          </div>
          <div className="mt-2 grid grid-cols-7 text-center text-caption text-muted" aria-hidden>
            {WEEKDAYS.map((w) => (
              <span key={w} className="py-1">
                {w}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7" role="grid" aria-label={`${MONTHS[view.m]} ${view.y}`}>
            {cells.map((c, i) => {
              if (!c) return <span key={`b${i}`} />;
              const inRange = lo && hi && c >= lo && c <= hi;
              const edge = c === lo || c === hi;
              return (
                <button
                  key={c}
                  type="button"
                  data-date={c}
                  onClick={() => pick(c)}
                  onMouseEnter={() => anchor && setHover(c)}
                  aria-label={`${parts(c).d} ${MONTHS[parts(c).m]} ${parts(c).y}`}
                  aria-pressed={Boolean(inRange)}
                  className={cx(
                    "num h-9 text-small transition-colors",
                    inRange ? "bg-accent/40" : "hover:bg-active",
                    edge && "bg-accent font-semibold text-on-accent",
                    c === lo && "rounded-l-full",
                    c === hi && "rounded-r-full",
                    !inRange && "rounded-full",
                    c === today && !edge && "font-semibold underline decoration-accent decoration-2 underline-offset-4",
                  )}
                >
                  {parts(c).d}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-caption text-muted">{anchor ? "Now click an end date, or click the same day again." : "Click a day. Click a second day to make a range."}</p>
        </div>
      )}
    </div>
  );
}
