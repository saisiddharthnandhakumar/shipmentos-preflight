"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { api, ApiClientError, newRequestId } from "@/lib/client/api";
import { stashUpload, xlsxProblem } from "@/lib/client/pending-upload";
import { emptyDraft } from "@/lib/domain/schemas";
import { BookingFormFields, buildOps, formFromDraft, type FormValues, type ItemForm } from "../chat/edit-booking";
import { useHistory } from "../shell/history-context";
import { Button, Notice, PageHeader, cx } from "../ui";

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" className="size-6" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const CARD = "group flex min-h-56 flex-col rounded-3xl bg-sheet p-6 text-left transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2";

function Choice({ icon: glyph, title, body, cta, tone }: { icon: ReactNode; title: string; body: string; cta: string; tone: string }) {
  return (
    <>
      <span className={cx("grid size-12 place-items-center rounded-full", tone)}>{glyph}</span>
      <span className="text-heading mt-6 text-text">{title}</span>
      <span className="mt-2 text-sm text-muted">{body}</span>
      <span className="mt-auto pt-6 text-small font-medium text-text">
        {cta} <span aria-hidden className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
      </span>
    </>
  );
}

export function NewBooking() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<"choose" | "manual">("choose");
  const [error, setError] = useState<string | null>(null);

  function onFile(file: File | undefined) {
    if (!file) return;
    const problem = xlsxProblem(file);
    if (problem) {
      setError(problem);
      return;
    }
    stashUpload(file);
    router.push(`/chat?new=${Date.now().toString(36)}`);
  }

  if (view === "manual") return <ManualForm onBack={() => setView("choose")} />;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 pt-2 pb-10 lg:px-6">
        <PageHeader title="New booking" description="How would you like to add this shipment? Everything is checked against the same 10 rules whichever way you choose." />
        {error && (
          <div className="mt-4">
            <Notice tone="error" action={<button className="underline" onClick={() => setError(null)}>Dismiss</button>}>
              {error}
            </Notice>
          </div>
        )}
        <div className="mt-6 grid gap-4 md:grid-cols-3" data-testid="booking-methods">
          <button type="button" className={CARD} onClick={() => input.current?.click()} data-testid="method-excel">
            <Choice
              icon={icon("M12 15V3m0 0L8 7m4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4")}
              title="Upload Excel file"
              body="Pick an .xlsx from your computer. I'll read it, then tell you what's in it and what's still missing."
              cta="Choose a file"
              tone="bg-accent text-on-accent"
            />
          </button>
          <input
            ref={input}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            data-testid="method-excel-input"
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button type="button" className={CARD} onClick={() => setView("manual")} data-testid="method-manual">
            <Choice
              icon={icon("M4 6h16M4 12h16M4 18h10")}
              title="Fill out details manually"
              body="A form with every field on one page. Fill in what you know and leave the rest blank."
              cta="Open the form"
              tone="bg-lavender text-[#1c1c1c]"
            />
          </button>
          <button type="button" className={CARD} onClick={() => router.push(`/chat?new=${Date.now().toString(36)}`)} data-testid="method-chat">
            <Choice
              icon={icon("M4 5h16v11H9l-5 4Z")}
              title="Chat"
              body="Describe the shipment in your own words, typed or spoken. I'll fill in the booking and ask only for what's missing."
              cta="Start chatting"
              tone="bg-raised text-text"
            />
          </button>
        </div>
        <p className="mt-6 text-caption text-muted">
          Have several bookings in one spreadsheet? Use <Link href="/upload" className="font-medium text-accent-ink underline-offset-2 hover:underline">Master Data</Link> in the menu to check them all at once.
        </p>
      </div>
    </div>
  );
}

function ManualForm({ onBack }: { onBack: () => void }) {
  const router = useRouter();
  const history = useHistory();
  const [{ b, items }, setForm] = useState(() => formFromDraft(emptyDraft()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createKey = useRef(newRequestId());

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const ops = buildOps(emptyDraft(), b, items);
    if (!ops.length) {
      setError("Fill in at least one detail first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { bookingId } = await api<{ bookingId: string }>("/api/bookings", { method: "POST", body: { clientKey: createKey.current } });
      await api(`/api/bookings/${bookingId}`, { method: "PATCH", body: { expectedRevision: 0, requestId: newRequestId(), operations: ops } });
      router.push(`/chat/${bookingId}`);
    } catch (err) {
      setError(`Not saved. ${err instanceof ApiClientError ? err.message : "Something went wrong."}`);
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <form onSubmit={save} className="mx-auto max-w-5xl px-4 pt-2 pb-10 lg:px-6" data-testid="manual-form">
        <button type="button" onClick={onBack} className="text-small font-medium text-muted hover:text-text">
          ← Back to options
        </button>
        <PageHeader title="Fill out details manually" description="Fill in what you know and leave the rest blank. When you save, every rule is checked and I'll tell you what's still missing." />
        <div className="mt-6 rounded-3xl bg-sheet p-5 sm:p-6">
          <BookingFormFields b={b} setB={(v: FormValues) => setForm((f) => ({ ...f, b: v }))} items={items} setItems={(v: ItemForm[]) => setForm((f) => ({ ...f, items: v }))} />
          {error && (
            <div className="mt-4" role="alert">
              <Notice tone="error">{error}</Notice>
            </div>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" onClick={onBack} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !history.sessionReady} data-testid="manual-save">
              {busy ? "Saving…" : "Save and check"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
