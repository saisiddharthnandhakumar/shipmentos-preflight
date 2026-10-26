"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, ApiClientError, newRequestId } from "@/lib/client/api";
import type { BookingSnapshot, MessagesResponse, PatchOp, StoredMessage, TurnResponse } from "@/lib/client/types";

type UploadState = { name: string; state: "reading" | "failed"; error?: string };
type ImportResult = ({ kind: "booking" } & TurnResponse) | { kind: "batch"; batchId: string; total: number; filename: string };
import { draftReferenceOf } from "@/lib/client/reference";
import { RULE_DEFINITIONS } from "@/lib/domain/reference";
import { buildChecklist } from "@/lib/domain/checklist";
import { choicesFor, type ChoiceGroup, type ChoiceOption } from "@/lib/domain/choices";
import { missingFields } from "@/lib/domain/missing";
import type { DraftBooking } from "@/lib/domain/schemas";
import { Checklist } from "./checklist";
import { BookingName } from "./booking-name";
import { stageOf } from "@/lib/domain/stage";
import { useHistory } from "../shell/history-context";
import { CarrierPanel, Collapsible, FactsList, FixList, ItemsTable, PreflightStrip, RuleChecklist, StatusSummary } from "../booking/parts";
import { Button, ConfirmDialog, Notice, Skeleton, cx } from "../ui";
import { hasStashedUpload, takeStashedUpload, xlsxProblem } from "@/lib/client/pending-upload";
import { VoiceButton, type VoiceStatus } from "../voice-button";
import { SendToErpButton } from "../booking/send-to-erp";
import { EditBookingDialog } from "./edit-booking";

type Pending = { requestId: string; text: string; state: "sending" | "failed"; error?: string; retryable: boolean; ops?: PatchOp[] };

const FIELD_KEYS = ["sellerName", "originCity", "destinationCity", "destinationType", "readyToShipDate", "sellerPriority", "pallets", "cartons", "totalDeclaredValueGBP", "totalGrossWeightKg", "deliveryAppointmentBooked"] as const;

const GREETING: StoredMessage = {
  id: "greeting",
  seq: 0,
  role: "assistant",
  content:
    "Hi, let's book a shipment. Tell me where it's going, what's in it, how many pallets and when it's ready. Type it, or tap the mic and say it. I'll fill in the booking and ask only for what's missing.",
  revision: null,
  createdAt: "",
};

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
  // Tap-to-answer picks held back until every visible group has one, so the chat continues once per round, not per tap.
  const [picked, setPicked] = useState<Record<string, ChoiceOption>>({});
  const router = useRouter();
  // A new chat opens with the greeting, unless it was started by uploading a spreadsheet.
  const [greet] = useState(() => initialBookingId === null && !hasStashedUpload());
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [replacing, setReplacing] = useState<{ file: File; hadFile: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [voice, setVoice] = useState<VoiceStatus>(null);
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

  // Focus the message box once it is usable (the session can still be starting).
  const composerUsable = loadState === "ready" && history.sessionReady;
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (greet && composerUsable && !focusedOnce.current) {
      focusedOnce.current = true;
      composer.current?.focus();
    }
  }, [greet, composerUsable]);

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
  }

  async function send(raw: string, retryOf?: Pending, tapped?: PatchOp[]) {
    const message = raw.trim();
    if (!message || pending?.state === "sending") return;
    const ops = tapped ?? retryOf?.ops;
    const requestId = retryOf?.retryable ? retryOf.requestId : newRequestId();
    setPending({ requestId, text: message, state: "sending", retryable: true, ops });
    setText("");
    stickToBottom.current = true;
    try {
      const id = await ensureBooking();
      const r = await api<TurnResponse>("/api/chat", {
        method: "POST",
        body: { bookingId: id, expectedRevision: snap?.booking.revision ?? 0, requestId, message, ...(ops ? { operations: ops } : {}) },
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
        setPending({ requestId, text: message, state: "failed", retryable: false, ops, error: "This booking changed in another tab, so your message wasn't applied. The latest version is loaded — send it again if it still applies." });
      } else {
        const hint = err.code === "AI_UNAVAILABLE" ? " You can also use Edit booking to enter details directly." : "";
        setPending({ requestId, text: message, state: "failed", retryable: true, ops, error: `Not saved. ${err.message}${hint}` });
      }
    }
  }

  function pick(groups: ChoiceGroup[], key: string, option: ChoiceOption) {
    const next = { ...picked };
    if (next[key]?.label === option.label) delete next[key];
    else next[key] = option;
    const chosen = groups.map((g) => next[g.key]);
    if (chosen.every((o): o is ChoiceOption => Boolean(o))) {
      setPicked({});
      void send(chosen.map((o) => o.say).join(". "), undefined, chosen.flatMap((o) => o.ops));
    } else setPicked(next);
  }

  async function uploadFile(file: File) {
    setUpload({ name: file.name, state: "reading" });
    stickToBottom.current = true;
    try {
      const id = await ensureBooking();
      const form = new FormData();
      form.append("file", file);
      form.append("expectedRevision", String(snap?.booking.revision ?? 0));
      form.append("requestId", newRequestId());
      const r = await api<ImportResult>(`/api/chats/${id}/import`, { method: "POST", form });
      if (r.kind === "batch") {
        router.push(`/upload/${r.batchId}`);
        return;
      }
      applyTurn(r);
      setUpload(null);
    } catch (e) {
      const err = e instanceof ApiClientError ? e : new ApiClientError(0, "UNKNOWN", "Something went wrong.");
      if (err.code === "STALE_REVISION") {
        const latest = (err.details as { snapshot?: BookingSnapshot } | undefined)?.snapshot;
        if (latest) setSnap(latest);
        setUpload({ name: file.name, state: "failed", error: "This booking changed in another tab, so the file wasn't read. The latest version is loaded — upload it again if you still want it." });
      } else setUpload({ name: file.name, state: "failed", error: err.message });
    }
  }

  function pickFile(file: File | undefined) {
    if (!file) return;
    const problem = xlsxProblem(file);
    if (problem) {
      setVoice({ text: problem, tone: "error" });
      return;
    }
    setVoice(null);
    const hadFile = Boolean(snap?.revisions.some((r) => r.source === "import"));
    const hasDetails = snap ? snap.draft.items.length > 0 || FIELD_KEYS.some((k) => snap.draft[k] !== null && snap.draft[k] !== undefined) : false;
    if (hadFile || hasDetails) setReplacing({ file, hadFile });
    else void uploadFile(file);
  }

  // Started from the New booking page with a spreadsheet: read it as soon as the session is ready.
  const autoUpload = useRef(false);
  useEffect(() => {
    if (autoUpload.current || !history.sessionReady || initialBookingId) return;
    const file = takeStashedUpload();
    autoUpload.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kick off the hand-off upload once
    if (file) void uploadFile(file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.sessionReady]);

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
  const empty = loadState === "ready" && messages.length === 0 && !pending && !upload;
  // The opening message is local: nothing is created or listed in history until the seller actually sends something.
  const checkDraft = (snap?.draft ?? emptyDraftClient) as DraftBooking;
  const checkMissing = evaluation?.missingFields ?? missingFields(checkDraft);
  const checklist = buildChecklist(checkDraft, checkMissing);
  const choices = choicesFor(checkDraft, checkMissing);
  const canAnswer = loadState === "ready" && history.sessionReady && !pending && upload?.state !== "reading" && !confirmed && choices.length > 0 && (messages.length > 0 || greet);
  const showGreeting = greet && !olderCursor && loadState === "ready";

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
              <h1 className="sr-only">{snap?.booking.title && snap.booking.title !== "New shipment" ? snap.booking.title : "Book a shipment"}</h1>
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
                {showGreeting && <MessageBubble m={GREETING} />}
                {greet && empty && (
                  <li data-testid="chat-empty" className="pl-[34px]">
                    <p className="text-small font-medium text-text">Try one of these</p>
                    <div className="mt-2 space-y-2">
                      {EXAMPLES.map((ex) => (
                        <button key={ex} type="button" onClick={() => { setText(ex); composer.current?.focus(); }} className="block w-full rounded-2xl bg-raised px-4 py-3 text-left text-small text-text transition-colors hover:bg-active">
                          {ex}
                        </button>
                      ))}
                    </div>
                  </li>
                )}
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
                {canAnswer && (
                  <li className="space-y-3 pl-[34px]" data-testid="quick-replies" aria-label="Tap to answer">
                    {choices.map((g) => (
                      <div key={g.key} data-choice-group={g.key}>
                        <p className="text-caption font-medium text-muted">{g.prompt}</p>
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          {g.options.map((o: ChoiceOption) => {
                            const on = picked[g.key]?.label === o.label;
                            return (
                              <button
                                key={o.label}
                                type="button"
                                aria-pressed={on}
                                onClick={() => pick(choices, g.key, o)}
                                className={cx("inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-small font-medium transition-colors", on ? "border-primary bg-primary text-on-primary" : "border-control bg-sheet text-text hover:bg-active")}
                                data-choice={o.label}
                              >
                                {o.label}
                                {o.hint && <span className={cx("text-caption font-normal", on ? "text-on-primary/70" : "text-muted")}>{o.hint}</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </li>
                )}
                {upload && (
                  <>
                    <li className="flex justify-end" data-testid="upload-message">
                      <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-active px-4 py-2.5 text-sm leading-6 break-words text-text">Uploaded {upload.name}</div>
                    </li>
                    <li className="flex gap-2.5" data-testid="upload-status">
                      <span aria-hidden className="mt-1 grid size-6 flex-none place-items-center rounded-md bg-accent-soft text-caption font-semibold text-accent-ink">
                        S
                      </span>
                      {upload.state === "reading" ? (
                        <p className="text-sm leading-6 text-muted" role="status">
                          Reading your spreadsheet and extracting the booking details…
                        </p>
                      ) : (
                        <div className="min-w-0 flex-1 text-sm leading-6" role="alert">
                          <p className="text-red-ink">{upload.error}</p>
                          <div className="mt-1.5 flex gap-2">
                            <Button size="sm" onClick={() => fileInput.current?.click()}>
                              Choose another file
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setUpload(null)}>
                              Dismiss
                            </Button>
                          </div>
                        </div>
                      )}
                    </li>
                  </>
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
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={loadState !== "ready" || !history.sessionReady || pending?.state === "sending" || upload?.state === "reading"}
                  aria-label="Upload an Excel file"
                  title="Upload an Excel file (.xlsx)"
                  data-testid="attach-file"
                  className="grid size-12 flex-none place-items-center rounded-full bg-raised text-text transition-colors hover:bg-active disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <svg viewBox="0 0 24 24" className="size-5" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m21 11.5-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9" />
                  </svg>
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                  data-testid="attach-input"
                  onChange={(e) => {
                    pickFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
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
                <VoiceButton
                  onStatus={setVoice}
                  onTranscript={(t) => {
                    setText((prev) => `${prev.trim() ? `${prev.trim()} ` : ""}${t}`.slice(0, 2000));
                    composer.current?.focus();
                  }}
                  disabled={loadState !== "ready" || !history.sessionReady || pending?.state === "sending"}
                />
                <Button type="submit" variant="primary" className="h-12 px-6" disabled={!text.trim() || pending?.state === "sending" || upload?.state === "reading" || loadState !== "ready"} data-testid="send">
                  {pending?.state === "sending" ? "Sending…" : "Send"}
                </Button>
              </div>
              <p className={cx("mx-auto mt-1.5 max-w-[720px] text-caption", voice ? (voice.tone === "error" ? "text-red-ink" : "text-text") : "text-faint")} role="status" data-testid="voice-status">
                {voice?.text ?? "AI reads your words; every check, price and date is calculated by fixed rules. Nothing is booked with a carrier."}
              </p>
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
            {snap && (
              <BookingName
                bookingId={snap.booking.id}
                name={snap.booking.externalBookingId}
                fallback={draftReferenceOf(snap.booking.id)}
                disabled={loadState !== "ready" || pending?.state === "sending" || confirmed}
                onSaved={(name) => setSnap((cur) => (cur ? { ...cur, booking: { ...cur.booking, externalBookingId: name }, draft: { ...cur.draft, externalBookingId: name } } : cur))}
              />
            )}
            {!evaluation ? (
              loadState === "loading" ? (
                <div className="mt-3 space-y-2">
                  <Skeleton className="h-6 w-36" />
                  <Skeleton className="h-11" />
                  <Skeleton className="h-48" />
                </div>
              ) : (
                <div className="mt-2" data-testid="panel-empty">
                  <p className="text-small text-muted">Your booking builds here as you describe it. Each detail is ticked off as it arrives.</p>
                  <div className="mt-4">
                    <Checklist data={checklist} />
                  </div>
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

                {!confirmed && snap && (
                  <div className="flex flex-wrap items-center gap-2" data-testid="save-draft-row">
                    <Button
                      onClick={() => {
                        const stage = stageOf({ status: evaluation.status, confirmed: false });
                        router.push(`/bookings?tab=${stage}&saved=${snap.booking.id}`);
                      }}
                      disabled={pending?.state === "sending" || upload?.state === "reading"}
                      data-testid="save-draft"
                    >
                      Save as draft
                    </Button>
                    <span className="text-caption text-muted">Everything is saved as you go. This takes you to your list.</span>
                  </div>
                )}

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

                <Checklist data={checklist} />

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

      <ConfirmDialog
        open={Boolean(replacing)}
        title={replacing?.hadFile ? "Replace the uploaded file?" : "Replace the details in this booking?"}
        body={
          replacing?.hadFile ? (
            <p>
              There&apos;s already a file in this chat. Do you want to continue? Everything currently in this booking will be removed and replaced with the details from <strong className="font-medium text-text">{replacing?.file.name}</strong>.
            </p>
          ) : (
            <p>
              This chat already has booking details. Reading <strong className="font-medium text-text">{replacing?.file.name}</strong> will remove them and replace them with the file&apos;s details.
            </p>
          )
        }
        confirmLabel="Continue and replace"
        danger
        onCancel={() => setReplacing(null)}
        onConfirm={() => {
          const file = replacing?.file;
          setReplacing(null);
          if (file) void uploadFile(file);
        }}
      />

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
