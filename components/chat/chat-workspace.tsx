"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, ApiClientError, newRequestId } from "@/lib/client/api";
import type { BookingSnapshot, MessagesResponse, PatchOp, StoredMessage, TurnResponse } from "@/lib/client/types";
import { draftReferenceOf } from "@/lib/client/reference";
import { RULE_DEFINITIONS } from "@/lib/domain/reference";
import { useHistory } from "../shell/history-context";
import { CarrierPanel, Collapsible, FactsList, FixList, ItemsTable, PreflightStrip, RuleChecklist, StatusSummary } from "../booking/parts";
import { Button, Notice, Skeleton, cx } from "../ui";
import { SendToErpButton } from "../booking/send-to-erp";
import { EditBookingDialog } from "./edit-booking";

type Pending = { requestId: string; text: string; state: "sending" | "failed"; error?: string; retryable: boolean };

const EXAMPLES = [
  "I need 3 pallets of ceramic mugs from Manchester to a warehouse in Frankfurt, ready 5 Nov. Cheapest please.",
  "Sending 2 pallets of cotton t-shirts from Leeds to a shop in Lyon, as fast as possible.",
];

export function ChatWorkspace({ initialBookingId }: { initialBookingId: string | null }) {
  const history = useHistory();
  const [bookingId, setBookingId] = useState<string | null>(initialBookingId);
  const [snap, setSnap] = useState<BookingSnapshot | null>(null);
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "notfound" | "error">(initialBookingId ? "loading" : "ready");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState("");
  const [tab, setTab] = useState<"chat" | "booking">("chat");
  const [editing, setEditing] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [panelNotice, setPanelNotice] = useState<string | null>(null);
  const createKey = useRef(newRequestId());
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const composer = useRef<HTMLTextAreaElement>(null);

  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!initialBookingId || !history.sessionReady) return;
    let alive = true;
    Promise.all([
      api<BookingSnapshot>(`/api/bookings/${initialBookingId}`),
      api<MessagesResponse>(`/api/chats/${initialBookingId}/messages?limit=40`),
    ])
      .then(([s, m]) => {
        if (!alive) return;
        setSnap(s);
        setMessages(m.messages);
        setOlderCursor(m.nextCursor);
        stickToBottom.current = true;
        setLoadState("ready");
      })
      .catch((e) => {
        if (!alive) return;
        if (e instanceof ApiClientError && e.status === 404) setLoadState("notfound");
        else {
          setLoadError(e instanceof ApiClientError ? e.message : "Couldn't load this conversation.");
          setLoadState("error");
        }
      });
    return () => {
      alive = false;
    };
  }, [initialBookingId, history.sessionReady, reload]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  async function loadOlder() {
    if (!bookingId || !olderCursor) return;
    const el = scroller.current;
    const before = el ? el.scrollHeight - el.scrollTop : 0;
    setLoadingOlder(true);
    try {
      const r = await api<MessagesResponse>(`/api/chats/${bookingId}/messages?limit=40&cursor=${olderCursor}`);
      stickToBottom.current = false;
      setMessages((prev) => [...r.messages.filter((m) => !prev.some((p) => p.id === m.id)), ...prev]);
      setOlderCursor(r.nextCursor);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - before;
      });
    } finally {
      setLoadingOlder(false);
    }
  }

  async function ensureBooking(): Promise<string> {
    if (bookingId) return bookingId;
    const r = await api<{ bookingId: string }>("/api/bookings", { method: "POST", body: { clientKey: createKey.current } });
    setBookingId(r.bookingId);
    // Keep this component mounted (and any in-flight message) while the URL becomes shareable/refreshable.
    window.history.replaceState(null, "", `/chat/${r.bookingId}`);
    return r.bookingId;
  }

  function applyTurn(r: TurnResponse) {
    setSnap(r.snapshot);
    stickToBottom.current = true;
    setMessages((prev) => [...prev, ...r.messages.filter((m) => !prev.some((p) => p.id === m.id))]);
    void history.refreshChats();
  }

  async function send(raw: string, retryOf?: Pending) {
    const message = raw.trim();
    if (!message || pending?.state === "sending") return;
    const requestId = retryOf?.retryable ? retryOf.requestId : newRequestId();
    setPending({ requestId, text: message, state: "sending", retryable: true });
    setText("");
    stickToBottom.current = true;
    try {
      const id = await ensureBooking();
      const r = await api<TurnResponse>("/api/chat", {
        method: "POST",
        body: { bookingId: id, expectedRevision: snap?.booking.revision ?? 0, requestId, message },
      });
      applyTurn(r);
      setPending(null);
    } catch (e) {
      const err = e instanceof ApiClientError ? e : new ApiClientError(0, "UNKNOWN", "Something went wrong.");
      if (err.code === "STALE_REVISION") {
        const latest = (err.details as { snapshot?: BookingSnapshot } | undefined)?.snapshot;
        if (latest) setSnap(latest);
        if (bookingId) {
          const m = await api<MessagesResponse>(`/api/chats/${bookingId}/messages?limit=40`).catch(() => null);
          if (m) setMessages(m.messages);
        }
        setPending({ requestId, text: message, state: "failed", retryable: false, error: "This booking changed in another tab, so your message wasn't applied. The latest version is loaded — send it again if it still applies." });
      } else {
        const hint = err.code === "AI_UNAVAILABLE" ? " You can also use Edit booking to enter details directly." : "";
        setPending({ requestId, text: message, state: "failed", retryable: true, error: `Not saved. ${err.message}${hint}` });
      }
    }
  }

  async function saveEdit(ops: PatchOp[]) {
    setEditBusy(true);
    setEditError(null);
    try {
      const id = await ensureBooking();
      const r = await api<TurnResponse>(`/api/bookings/${id}`, { method: "PATCH", body: { expectedRevision: snap?.booking.revision ?? 0, requestId: newRequestId(), operations: ops } });
      applyTurn(r);
      setEditing(false);
    } catch (e) {
      const err = e as ApiClientError;
      if (err.code === "STALE_REVISION") {
        const latest = (err.details as { snapshot?: BookingSnapshot } | undefined)?.snapshot;
        if (latest) setSnap(latest);
        setEditError("This booking changed elsewhere. The latest version is loaded — please review and save again.");
      } else setEditError(`Not saved. ${err.message ?? ""}`);
    } finally {
      setEditBusy(false);
    }
  }

  async function confirmDraft() {
    if (!bookingId || !snap) return;
    setConfirmBusy(true);
    setPanelNotice(null);
    try {
      const r = await api<TurnResponse>(`/api/bookings/${bookingId}/confirm`, { method: "POST", body: { expectedRevision: snap.booking.revision, requestId: newRequestId() } });
      applyTurn(r);
    } catch (e) {
      setPanelNotice(e instanceof ApiClientError ? e.message : "Couldn't send to the ERP.");
    } finally {
      setConfirmBusy(false);
    }
  }

  if (loadState === "notfound")
    return (
      <div className="m-auto max-w-md p-6 text-center" data-testid="chat-not-found">
        <h1 className="text-heading">Conversation not found</h1>
        <p className="mt-2 text-sm text-muted">It may have been deleted, or it belongs to a different browser session. Chats are only available in the browser that created them.</p>
        <Link href="/chat" className="mt-4 inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-sm font-medium text-on-primary">
          Start a new chat
        </Link>
      </div>
    );

  const evaluation = snap?.evaluation ?? null;
  const missingKeys = new Set(evaluation?.missingFields.map((m) => m.key) ?? []);
  const saveState = pending?.state === "sending" ? "saving" : pending?.state === "failed" ? "unsaved" : "saved";
  const confirmed = snap?.booking.confirmedRevision != null && snap.booking.confirmedRevision === snap.booking.revision;
  const canConfirm = evaluation && (evaluation.status === "Ready to submit" || evaluation.status === "Needs attention") && !confirmed;
  const empty = loadState === "ready" && messages.length === 0 && !pending;

  return (
    <div className="flex h-full min-h-0 flex-col px-3 pb-3 lg:px-6 lg:pb-6">
      {/* Phone/tablet: one region at a time */}
      <div role="tablist" aria-label="Chat view" className="mb-3 flex flex-none gap-1 rounded-full bg-sheet p-1 lg:hidden">
        {(["chat", "booking"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cx("h-9 flex-1 rounded-full px-3 text-small font-medium", tab === t ? "bg-primary text-on-primary" : "text-muted")}
            data-testid={`tab-${t}`}
          >
            {t === "chat" ? "Conversation" : `Booking${evaluation ? ` · ${evaluation.status}` : ""}`}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Conversation */}
        <section aria-label="Conversation" className={cx("min-w-0 flex-1 flex-col overflow-hidden rounded-3xl bg-sheet", tab === "chat" ? "flex" : "hidden lg:flex")}>
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto" onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}>
            <div className="mx-auto w-full max-w-[720px] px-4 py-6">
              <h1 className={cx("text-title text-ink", !empty && "sr-only")}>{snap?.booking.title && snap.booking.title !== "New shipment" ? snap.booking.title : "Book a shipment"}</h1>
              {empty && (
                <div data-testid="chat-empty">
                  <p className="mt-1 max-w-[56ch] text-sm text-muted">
                    Say where it&apos;s going, what&apos;s in it, how many pallets and when it&apos;s ready. I&apos;ll fill in the booking and ask only for what&apos;s missing.
                  </p>
                  <p className="mt-5 text-small font-medium text-text">Try one of these</p>
                  <div className="mt-2 space-y-2">
                    {EXAMPLES.map((ex) => (
                      <button key={ex} type="button" onClick={() => setText(ex)} className="block w-full rounded-2xl bg-raised px-4 py-3 text-left text-small text-text transition-colors hover:bg-active">
                        {ex}
                      </button>
                    ))}
                  </div>
                  <p className="mt-4 text-caption text-muted">Prefer a form? <button className="font-medium text-accent-ink underline-offset-2 hover:underline" onClick={() => setEditing(true)}>Fill it in by hand</button>. Have a spreadsheet? <Link href="/upload" className="font-medium text-accent-ink underline-offset-2 hover:underline">Upload Excel</Link>.</p>
                </div>
              )}
              {loadState === "loading" && (
                <div className="space-y-4" aria-label="Loading conversation">
                  <Skeleton className="ml-auto h-12 w-2/3" />
                  <Skeleton className="h-20 w-5/6" />
                  <Skeleton className="ml-auto h-10 w-1/2" />
                </div>
              )}
              {loadState === "error" && (
                <Notice tone="error" action={<button className="underline" onClick={() => { setLoadState("loading"); setLoadError(null); setReload((n) => n + 1); }}>Retry</button>}>
                  {loadError}
                </Notice>
              )}
              {olderCursor && (
                <div className="mb-4 text-center">
                  <Button size="sm" onClick={() => void loadOlder()} disabled={loadingOlder} data-testid="load-older">
                    {loadingOlder ? "Loading…" : "Load earlier messages"}
                  </Button>
                </div>
              )}
              <ol className="space-y-4" data-testid="transcript" aria-live="polite" aria-relevant="additions">
                {messages.map((m) => (
                  <MessageBubble key={m.id} m={m} />
                ))}
                {pending && (
                  <li className="flex flex-col items-end" data-testid="pending-message">
                    <div className={cx("max-w-[85%] rounded-3xl rounded-br-lg px-4 py-2.5 text-sm leading-6 whitespace-pre-wrap", pending.state === "failed" ? "border border-red-line bg-red-bg/50" : "bg-active")}>
                      {pending.text}
                    </div>
                    {pending.state === "sending" ? (
                      <p className="mt-1 text-caption text-muted" role="status">
                        Reading your message and re-checking the booking…
                      </p>
                    ) : (
                      <div className="mt-1.5 flex max-w-[85%] flex-col items-end gap-1.5 text-right" role="alert">
                        <p className="text-caption text-red-ink">{pending.error}</p>
                        <div className="flex gap-2">
                          <Button size="sm" variant="ghost" onClick={() => { setText(pending.text); setPending(null); }}>
                            Edit text
                          </Button>
                          <Button size="sm" onClick={() => void send(pending.text, pending)} data-testid="retry-send">
                            {pending.retryable ? "Retry" : "Send again"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                )}
              </ol>
            </div>
          </div>
          <form
            className="flex-none px-4 pb-4 pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send(text);
            }}
          >
            <div className="mx-auto flex w-full max-w-[720px] items-end gap-2">
              <label className="sr-only" htmlFor="composer">
                Message
              </label>
              <textarea
                id="composer"
                name="message"
                autoComplete="off"
                ref={composer}
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, 2000))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send(text);
                  }
                }}
                rows={1}
                placeholder={evaluation?.status === "Draft" || !evaluation ? "Describe your shipment…" : "Change anything, e.g. “add one more pallet”…"}
                className="max-h-40 min-h-12 flex-1 resize-none rounded-3xl bg-raised px-5 py-3 text-sm leading-6 placeholder:text-faint"
                disabled={loadState === "loading" || loadState === "error" || !history.sessionReady}
                data-testid="composer"
              />
              <Button type="submit" variant="primary" className="h-12 px-6" disabled={!text.trim() || pending?.state === "sending" || loadState !== "ready"} data-testid="send">
                {pending?.state === "sending" ? "Sending…" : "Send"}
              </Button>
            </div>
            <p className="mx-auto mt-1.5 max-w-[720px] text-caption text-faint">AI reads your words; every check, price and date is calculated by fixed rules. Nothing is booked with a carrier.</p>
          </form>
        </section>

        {/* Live booking panel */}
        <aside aria-label="Booking" className={cx("min-h-0 w-full flex-none overflow-y-auto rounded-3xl bg-sheet lg:w-[380px] xl:w-[420px]", tab === "booking" ? "block" : "hidden lg:block")} data-testid="booking-panel">
          <div className="px-5 pt-5 pb-8">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-heading text-text">Booking</h2>
              <Button size="sm" onClick={() => setEditing(true)} disabled={loadState !== "ready" || pending?.state === "sending"} data-testid="edit-booking">
                Edit booking
              </Button>
            </div>
            {!evaluation ? (
              loadState === "loading" ? (
                <div className="mt-3 space-y-2">
                  <Skeleton className="h-6 w-36" />
                  <Skeleton className="h-11" />
                  <Skeleton className="h-48" />
                </div>
              ) : (
                <div className="mt-2" data-testid="panel-empty">
                  <p className="text-small text-muted">Your booking builds here as you describe it. To check it, I need:</p>
                  <ul className="mt-3 space-y-2 text-sm text-text">
                    {["The route: UK city to a city in Germany, France or the Netherlands", "What you're sending, with HS code, quantity, price and weight", "Pallets, cartons and total weight", "When it's ready to ship, and the delivery appointment if it's a warehouse"].map((t) => (
                      <li key={t} className="flex gap-2.5">
                        <span aria-hidden className="mt-[7px] size-1.5 flex-none rounded-full bg-accent" />
                        {t}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-5">
                    <Collapsible title="What we check before you ship" defaultOpen={false}>
                      <p className="text-small text-muted">Ten checks run automatically as you give details. Nothing has been checked yet.</p>
                      {([
                        ["Red", "Blocking checks", "If one of these fails, the shipment shouldn't leave until it's fixed."],
                        ["Amber", "Advisory checks", "If one of these fails, you can still ship, but double-check first."],
                      ] as const).map(([sev, heading, blurb]) => (
                        <div key={sev} className="mt-4">
                          <h4 className="text-small font-semibold text-text">{heading}</h4>
                          <p className="text-caption text-muted">{blurb}</p>
                          <ul className="mt-1 divide-y divide-rule">
                            {RULE_DEFINITIONS.filter((r) => r.severity === sev).map((r) => (
                              <li key={r.ruleId} className="flex items-start gap-2 py-2">
                                <span aria-hidden className="mt-1.5 size-2 flex-none rounded-full border border-muted" />
                                <span className="w-10 flex-none pt-px font-mono text-caption text-muted">{r.ruleId}</span>
                                <span className="min-w-0 flex-1 text-small text-text">{r.description}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                      <p className="mt-3 text-caption text-muted">Carriers A, B and C are then ranked by your priority, after a weight-per-pallet check.</p>
                    </Collapsible>
                  </div>
                </div>
              )
            ) : (
              <div className="mt-3 space-y-5">
                <StatusSummary evaluation={evaluation} revision={snap?.booking.revision} saved={saveState} />
                <PreflightStrip rules={evaluation.rules} onSelect={(id) => document.getElementById(`rule-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} />

                {(confirmed || canConfirm) && (
                  <div className={cx("rounded-xl border p-3", confirmed ? "border-pass-line bg-pass-bg" : "border-border")} data-testid="confirmation">
                    {confirmed ? (
                      <>
                        <p className="text-small font-medium text-pass-ink">Sent to ERP · ref {draftReferenceOf(snap!.booking.id)}</p>
                        <p className="mt-1 text-small text-pass-ink">Queued for the ERP (simulated). No carrier contacted. Any later change clears this.</p>
                      </>
                    ) : (
                      <>
                        <p className="text-small text-text">{evaluation.status === "Needs attention" ? "Complete, with items to check. You can still send it to the ERP." : "Complete and all 10 checks pass."}</p>
                        <SendToErpButton size="sm" className="mt-2" onSend={() => void confirmDraft()} busy={confirmBusy} />
                      </>
                    )}
                    {panelNotice && <p className="mt-2 text-caption text-red-ink">{panelNotice}</p>}
                  </div>
                )}

                <FixList rules={evaluation.rules} />

                {evaluation.missingFields.length > 0 && (
                  <div data-testid="missing-fields">
                    <h3 className="text-card text-text">
                      Still needed <span className="num font-normal text-muted">{evaluation.missingFields.length}</span>
                    </h3>
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {evaluation.missingFields.slice(0, 14).map((m) => (
                        <li key={m.key} className="rounded-full bg-raised px-2.5 py-1 text-caption text-muted">
                          {m.label}
                        </li>
                      ))}
                      {evaluation.missingFields.length > 14 && <li className="px-1 py-1 text-caption text-muted">+{evaluation.missingFields.length - 14} more</li>}
                    </ul>
                  </div>
                )}

                <div>
                  <Collapsible title="Carrier and price">
                    <CarrierPanel carrier={evaluation.carrier} status={evaluation.status} timeline={evaluation.timeline} />
                  </Collapsible>
                  <Collapsible title="Shipment details">
                    <FactsList draft={snap!.draft} missingKeys={missingKeys} />
                  </Collapsible>
                  <Collapsible title="Items" count={String(snap!.draft.items.length)}>
                    <ItemsTable items={snap!.draft.items} />
                  </Collapsible>
                  <Collapsible title="Checks that passed" count={`${evaluation.rules.filter((r) => r.status === "pass").length}/10`} defaultOpen={false}>
                    <RuleChecklist rules={evaluation.rules} filter="passing" />
                    {evaluation.notes.map((n, i) => (
                      <p key={i} className="mt-2 rounded-lg bg-raised px-3 py-2 text-caption text-muted">
                        Clarification (not scored): {n}
                      </p>
                    ))}
                  </Collapsible>
                {snap!.revisions.length > 1 && (
                  <Collapsible title="Change log" count={String(snap!.revisions.length - 1)} defaultOpen={false}>
                    <ol className="space-y-1 text-caption text-muted" data-testid="change-log">
                      {snap!.revisions
                        .filter((r) => r.revision > 0)
                        .map((r) => (
                          <li key={r.revision} className="flex gap-2">
                            <span className="num w-10 flex-none text-text">rev {r.revision}</span>
                            <span className="min-w-0 flex-1">
                              {r.source === "chat" ? "Chat" : r.source === "edit" ? "Direct edit" : r.source === "confirm" ? "Sent to ERP" : r.source}
                              {Array.isArray(r.changedFields) && r.changedFields.length ? ` · ${(r.changedFields as string[]).join(", ")}` : " · no field changes"}
                            </span>
                          </li>
                        ))}
                    </ol>
                  </Collapsible>
                )}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {snap || !bookingId ? (
        <EditBookingDialog
          open={editing}
          draft={snap?.draft ?? emptyDraftClient}
          onClose={() => {
            setEditing(false);
            setEditError(null);
          }}
          onSubmit={(ops) => void saveEdit(ops)}
          busy={editBusy}
          error={editError}
        />
      ) : null}
    </div>
  );
}

const emptyDraftClient = {
  externalBookingId: null,
  sellerName: null,
  originCity: null,
  originCountry: "United Kingdom" as const,
  destinationCity: null,
  destinationCountry: null,
  destinationType: null,
  readyToShipDate: null,
  readyDateNote: null,
  sellerPriority: null,
  pallets: null,
  cartons: null,
  totalDeclaredValueGBP: null,
  currency: "GBP" as const,
  totalGrossWeightKg: null,
  deliveryAppointmentBooked: null,
  selectedCarrierKey: null,
  items: [],
};

function MessageBubble({ m }: { m: StoredMessage }) {
  if (m.role === "event")
    return (
      <li className="text-center text-caption text-muted" data-role="event">
        <span className="inline-block rounded-full bg-raised px-3 py-1">{m.content}</span>
      </li>
    );
  if (m.role === "user")
    return (
      <li className="flex justify-end" data-role="user">
        <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-active px-4 py-2.5 text-sm leading-6 break-words whitespace-pre-wrap text-text">{m.content}</div>
      </li>
    );
  return (
    <li className="flex gap-2.5" data-role="assistant">
      <span aria-hidden className="mt-1 grid size-6 flex-none place-items-center rounded-md bg-accent-soft text-caption font-semibold text-accent-ink">
        S
      </span>
      <div className="min-w-0 flex-1 text-sm leading-6 break-words whitespace-pre-wrap text-text">{m.content}</div>
    </li>
  );
}
