"use client";

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
        "inline-flex flex-none items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-55",
        size === "sm" ? "h-8 px-3 text-[13px]" : "h-9 px-3.5 text-sm",
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
    <span className={cx("inline-flex h-6 flex-none items-center gap-1 rounded-full px-2.5 text-xs font-medium whitespace-nowrap", s.cls, className)}>
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
  red: { cls: "bg-red-bg text-red-ink", label: "Red" },
  amber: { cls: "bg-amber-bg text-amber-ink", label: "Amber" },
  na: { cls: "bg-na-bg text-na-ink", label: "Not evaluable" },
};

export function RuleChip({ state, className }: { state: RuleState; className?: string }) {
  const s = RULE_STYLE[state];
  return (
    <span className={cx("inline-flex h-5 flex-none items-center gap-1 rounded-full px-2 text-[11px] font-medium whitespace-nowrap", s.cls, className)}>
      <Glyph kind={state} className="size-2" />
      {s.label}
    </span>
  );
}

export function SeverityTag({ severity }: { severity: "Red" | "Amber" }) {
  return (
    <span className={cx("font-mono text-[11px] font-medium", severity === "Red" ? "text-red-ink" : "text-amber-ink")}>{severity.toUpperCase()}</span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx("block rounded bg-active", className)} />;
}

export function Card({ title, action, children, className, id }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  const hid = useId();
  return (
    <section aria-labelledby={title ? hid : undefined} id={id} className={cx("rounded-xl border border-border bg-sheet", className)}>
      {title && (
        <header className="flex min-h-11 items-center justify-between gap-3 px-4 pt-3">
          <h3 id={hid} className="text-[13px] font-semibold text-text">
            {title}
          </h3>
          {action}
        </header>
      )}
      <div className="px-4 pt-2 pb-4">{children}</div>
    </section>
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
      className="m-auto w-[min(440px,calc(100vw-32px))] rounded-2xl border border-border bg-sheet p-0 text-text shadow-[0_12px_40px_rgba(0,0,0,0.22)]"
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
        "flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-[13px]",
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
