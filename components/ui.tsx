"use client";

import Link from "next/link";
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export function cx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex flex-none items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-55",
        size === "sm" ? "h-8 px-3.5 text-small" : "h-10 px-5 text-sm",
        variant === "primary" && "bg-primary text-on-primary hover:bg-primary-hover",
        variant === "secondary" && "border border-control bg-sheet text-text hover:bg-raised",
        variant === "ghost" && "text-muted hover:bg-active hover:text-text",
        variant === "danger" && "border border-red-line bg-sheet text-red-ink hover:bg-red-bg",
        className,
      )}
    />
  );
}

export type GlyphKind = "pass" | "red" | "amber" | "na";

/** Shape + colour together, so severity never relies on colour alone. */
export function Glyph({ kind, className }: { kind: GlyphKind; className?: string }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden className={cx("size-2.5 flex-none", className)}>
      {kind === "pass" && <path d="M2.5 6.3 5 8.6 9.5 3.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
      {kind === "red" && <path d="M6 1.8 10.6 10H1.4Z" fill="currentColor" />}
      {kind === "amber" && <circle cx="6" cy="6" r="3.6" fill="currentColor" />}
      {kind === "na" && <circle cx="6" cy="6" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.5" />}
    </svg>
  );
}

export type StatusName = "Draft" | "Blocked" | "Needs attention" | "Ready to submit";

const STATUS_STYLE: Record<string, { cls: string; glyph: GlyphKind }> = {
  Blocked: { cls: "bg-red-bg text-red-ink", glyph: "red" },
  "Needs attention": { cls: "bg-amber-bg text-amber-ink", glyph: "amber" },
  "Ready to submit": { cls: "bg-pass-bg text-pass-ink", glyph: "pass" },
  Draft: { cls: "bg-na-bg text-na-ink", glyph: "na" },
};

export function StatusPill({ status, className }: { status: string; className?: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.Draft;
  return (
    <span className={cx("inline-flex h-6 flex-none items-center gap-1 rounded-full px-2.5 text-caption font-medium whitespace-nowrap", s.cls, className)}>
      <Glyph kind={s.glyph} />
      {status}
    </span>
  );
}

export type RuleState = "pass" | "red" | "amber" | "na";
export function ruleState(r: { status: string; severity: string }): RuleState {
  if (r.status === "pass") return "pass";
  if (r.status === "not_evaluable") return "na";
  return r.severity === "Red" ? "red" : "amber";
}

const RULE_STYLE: Record<RuleState, { cls: string; label: string }> = {
  pass: { cls: "bg-pass-bg text-pass-ink", label: "Pass" },
  red: { cls: "bg-red-bg text-red-ink", label: "Fix needed" },
  amber: { cls: "bg-amber-bg text-amber-ink", label: "Check this" },
  na: { cls: "bg-na-bg text-na-ink", label: "Not evaluable" },
};

export function RuleChip({ state, className }: { state: RuleState; className?: string }) {
  const s = RULE_STYLE[state];
  return (
    <span className={cx("inline-flex h-5 flex-none items-center gap-1 rounded-full px-2 text-caption font-medium whitespace-nowrap", s.cls, className)}>
      <Glyph kind={state} className="size-2" />
      {s.label}
    </span>
  );
}

export function SeverityTag({ severity }: { severity: "Red" | "Amber" }) {
  return (
    <span className={cx("font-mono text-caption font-medium", severity === "Red" ? "text-red-ink" : "text-amber-ink")}>{severity === "Red" ? "Fix needed" : "Check this"}</span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx("block rounded bg-active", className)} />;
}

export function Card({ title, action, children, className, id, icon, tone = "light" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; id?: string; icon?: ReactNode; tone?: "light" | "dark" }) {
  const hid = useId();
  return (
    <section aria-labelledby={title ? hid : undefined} id={id} className={cx("rounded-3xl p-5 sm:p-6", tone === "dark" ? "on-charcoal dark-card text-text" : "bg-sheet", className)}>
      {title && (
        <header className="mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {icon && <IconBadge>{icon}</IconBadge>}
            <h3 id={hid} className="text-card truncate text-text">
              {title}
            </h3>
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/** The round grey chip that sits before a card title. */
export function IconBadge({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("grid size-9 flex-none place-items-center rounded-full bg-raised text-text", className)}>{children}</span>;
}

/** A number as the hero of its card: big figure, small muted unit beside it. */
export function Figure({ value, unit, size = "figure", className, tone }: { value: ReactNode; unit?: ReactNode; size?: "figure" | "display"; className?: string; tone?: string }) {
  return (
    <p className={cx("flex items-baseline gap-1.5", className)}>
      <span className={cx("num", size === "display" ? "text-display" : "text-figure", tone ?? "text-text")}>{value}</span>
      {unit && <span className="text-small text-muted">{unit}</span>}
    </p>
  );
}

/** Small lime pill for a delta or share, like "+5%". */
export function Chip({ children, tone = "lime", className }: { children: ReactNode; tone?: "lime" | "lavender" | "dark"; className?: string }) {
  return (
    <span className={cx("inline-flex h-5 items-center rounded-full px-2 text-caption font-medium", tone === "lime" && "bg-accent text-on-accent", tone === "lavender" && "bg-lavender text-[#1c1c1c]", tone === "dark" && "bg-[#1c1c1c] text-white", className)}>{children}</span>
  );
}

/** Modal built on the native <dialog>: focus trap, Escape and inert background come from the platform. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      aria-labelledby="confirm-title"
      className="m-auto w-[min(440px,calc(100vw-32px))] rounded-3xl border border-border bg-sheet p-0 text-text shadow-[0_12px_40px_rgba(0,0,0,0.22)]"
    >
      <div className="p-5">
        <h2 id="confirm-title" className="text-base font-semibold">
          {title}
        </h2>
        <div className="mt-2 text-sm text-muted">{body}</div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onCancel} disabled={busy} autoFocus>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

/** Side sheet (right on desktop, full-screen on phones) on the native <dialog>. */
export function Drawer({ open, onClose, label, children, side = "right" }: { open: boolean; onClose: () => void; label: string; children: ReactNode; side?: "left" | "right" }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cx(
        "fixed inset-y-0 m-0 h-dvh max-h-dvh border-border bg-sheet p-0 text-text",
        side === "right" ? "right-0 left-auto w-[min(720px,100vw)] border-l" : "left-0 w-[min(300px,88vw)] border-r",
      )}
    >
      {open && children}
    </dialog>
  );
}

export function Notice({ tone = "info", children, action }: { tone?: "info" | "error" | "warn"; children: ReactNode; action?: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-small",
        tone === "error" && "border-red-line bg-red-bg text-red-ink",
        tone === "warn" && "border-amber-line bg-amber-bg text-amber-ink",
        tone === "info" && "border-border bg-raised text-muted",
      )}
    >
      <div>{children}</div>
      {action}
    </div>
  );
}

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const m = Math.round(diff / 60_000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** One title per page. The description is a single sentence; the primary action sits at the right. */
export function PageHeader({ title, description, actions, id }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 id={id} className="text-title text-ink">
          {title}
        </h1>
        {description && <p className="mt-1 max-w-[62ch] text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-none flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function SectionHeading({ children, action, id }: { children: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 id={id} className="text-heading text-text">
        {children}
      </h2>
      {action}
    </div>
  );
}

const STAT_TONE: Record<string, string> = {
  red: "text-red-ink",
  amber: "text-amber-ink",
  pass: "text-pass-ink",
  na: "text-text",
};

/** A count you can act on: icon chip and label on top, the figure as the biggest thing on the card. */
export function Stat({ label, value, unit, tone = "na", glyph, href, hint, chip }: { label: string; value: number | string; unit?: string; tone?: "red" | "amber" | "pass" | "na"; glyph?: GlyphKind; href?: string; hint?: string; chip?: ReactNode }) {
  const body = (
    <>
      <span className="flex items-center gap-3">
        <IconBadge>{glyph ? <Glyph kind={glyph} className={cx("size-4", STAT_TONE[tone])} /> : null}</IconBadge>
        <span className="text-card text-text">{label}</span>
      </span>
      <span className="mt-5 flex items-end justify-between gap-2">
        <Figure value={value} unit={unit} size="display" />
        {chip}
      </span>
      {hint && <span className="mt-1 block text-caption text-muted">{hint}</span>}
    </>
  );
  const cls = "block rounded-3xl bg-sheet p-5";
  return href ? (
    <Link href={href} className={cx(cls, "transition-transform hover:-translate-y-0.5")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function EmptyState({ title, children, actions }: { title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="rounded-3xl bg-sheet px-6 py-12 text-center">
      <h2 className="text-heading text-text">{title}</h2>
      {children && <p className="mx-auto mt-1.5 max-w-[48ch] text-sm text-muted">{children}</p>}
      {actions && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </div>
  );
}
