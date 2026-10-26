"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { Button } from "../ui";

/** The booking's name (its Booking ID): shown with a pencil, edited inline. Clearing it restores the generated reference. */
export function BookingName({ bookingId, name, fallback, onSaved, disabled }: { bookingId: string; name: string | null; fallback: string; onSaved: (name: string | null) => void; disabled?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  async function save() {
    const next = value.trim() || null;
    if (next === (name ?? null)) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/bookings/${bookingId}/name`, { method: "PUT", body: { name: next } });
      onSaved(next);
      setEditing(false);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't rename. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!editing)
    return (
      <div className="mt-2 flex items-center gap-1.5" data-testid="booking-name">
        <span className="min-w-0 truncate text-small text-text" title={name ?? fallback}>
          <span className="text-muted">Name </span>
          <span className="font-medium" data-testid="booking-name-value">{name ?? fallback}</span>
        </span>
        <button
          type="button"
          onClick={() => {
            setValue(name ?? "");
            setError(null);
            setEditing(true);
          }}
          disabled={disabled}
          aria-label="Rename booking"
          title="Rename booking"
          data-testid="rename-booking"
          className="grid size-7 flex-none place-items-center rounded-full text-muted hover:bg-active hover:text-text disabled:opacity-55"
        >
          <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.5 2.5l3 3L5 14H2v-3z" />
          </svg>
        </button>
      </div>
    );

  return (
    <form
      className="mt-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="block">
        <span className="sr-only">Booking name</span>
        <input
          ref={input}
          value={value}
          maxLength={60}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          placeholder={fallback}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          data-testid="booking-name-input"
          className="h-9 w-full rounded-lg border border-control bg-sheet px-2.5 text-small"
        />
      </label>
      <p className="mt-1 text-caption text-muted">Leave it blank to use {fallback}.</p>
      {error && <p className="mt-1 text-caption text-red-ink" role="alert">{error}</p>}
      <div className="mt-2 flex gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={busy} data-testid="save-name">
          {busy ? "Saving…" : "Save name"}
        </Button>
        <Button type="button" size="sm" onClick={() => setEditing(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
