"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiClientError, ensureSession } from "@/lib/client/api";
import type { BookingListItem } from "@/lib/client/types";
import { Button, ConfirmDialog, Skeleton, cx, relativeTime } from "../ui";
import { useHistory } from "./history-context";
import { NAV } from "./nav";

export function LogoMark({ className }: { className?: string }) {
  // A pallet seen from the side: three deck boards over two blocks. Drawn for ShipmentOS.
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <rect x="2" y="3" width="20" height="13" rx="3" fill="var(--accent)" />
      <path d="M6 7.5h12M6 11.5h8" stroke="var(--on-accent)" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="3" y="18" width="5" height="3" rx="1" fill="var(--ink)" />
      <rect x="9.5" y="18" width="5" height="3" rx="1" fill="var(--ink)" />
      <rect x="16" y="18" width="5" height="3" rx="1" fill="var(--ink)" />
    </svg>
  );
}

const STATUS_DOT: Record<string, string> = {
  Blocked: "bg-negative",
  "Needs attention": "bg-dot-amber",
  "Ready to submit": "bg-positive",
  Draft: "bg-dot-draft",
};

export function HistorySidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const h = useHistory();
  const [pendingDelete, setPendingDelete] = useState<BookingListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const activeId = pathname.startsWith("/chat/") ? pathname.split("/")[2] : null;

  async function doDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api(`/api/chats/${pendingDelete.id}`, { method: "DELETE" });
      h.removeChat(pendingDelete.id);
      if (activeId === pendingDelete.id) {
        const next = h.chats?.find((c) => c.id !== pendingDelete.id);
        router.push(next ? `/chat/${next.id}` : "/chat");
      }
      setPendingDelete(null);
      void h.refreshChats();
    } catch (e) {
      setDeleteError(e instanceof ApiClientError ? e.message : "Couldn't delete — nothing was removed.");
    } finally {
      setDeleting(false);
    }
  }

  async function doReset() {
    setResetting(true);
    try {
      await api("/api/session", { method: "DELETE" });
      await ensureSession(true);
      window.location.replace(new URL("/chat", window.location.origin).href);
    } catch {
      setResetting(false);
      setConfirmReset(false);
    }
  }

  return (
    <nav aria-label="Conversation history" className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 flex-none items-center gap-2 px-4">
        <Link href="/today" onClick={onNavigate} className="flex items-center gap-2 rounded-md" aria-label="ShipmentOS home">
          <LogoMark className="size-6" />
          <span translate="no" className="text-card text-ink">ShipmentOS</span>
        </Link>
        <span className="ml-auto text-caption text-faint">UK → EU</span>
      </div>
      <div className="px-3 pt-1 pb-3">
        <Link
          href="/chat"
          onClick={(e) => {
            // Always a fresh, independent chat — even if the current URL was updated in place.
            e.preventDefault();
            onNavigate?.();
            router.push(`/chat?new=${Date.now().toString(36)}`);
          }}
          className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-control bg-sheet text-sm font-medium text-text hover:bg-raised"
          data-testid="new-chat"
        >
          <span aria-hidden className="text-base leading-none">+</span> New booking
        </Link>
      </div>

      <ul className="space-y-0.5 px-2 pb-2" aria-label="Sections">
        {NAV.map((n) => {
          const on = n.match(pathname);
          return (
            <li key={n.href}>
              <Link
                href={n.href}
                onClick={onNavigate}
                aria-current={on ? "page" : undefined}
                className={cx("flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm", on ? "bg-active font-medium text-text" : "text-muted hover:bg-active hover:text-text")}
              >
                {n.icon}
                {n.label}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
        <h2 className="text-caption font-medium text-faint">Previous chats</h2>
        {h.chats && h.chats.length > 0 && <span className="num text-caption text-faint">{h.chats.length}{h.nextCursor ? "+" : ""}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" data-testid="chat-list">
        {!h.sessionReady || h.chats === null ? (
          h.chatsError ? (
            <p className="px-2 py-2 text-small text-red-ink">
              {h.chatsError}{" "}
              <button className="underline" onClick={() => void h.refreshChats()}>
                Retry
              </button>
            </p>
          ) : (
            <div className="space-y-2 px-2 py-1" aria-label="Loading previous chats">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
              <Skeleton className="h-9 w-3/4" />
            </div>
          )
        ) : h.chats.length === 0 ? (
          <p className="px-2 py-2 text-small leading-5 text-muted">No chats yet in this browser. Start one and it will appear here.</p>
        ) : (
          <ul className="space-y-0.5">
            {h.chats.map((c) => {
              const active = c.id === activeId;
              return (
                <li key={c.id} className="group relative">
                  <Link
                    href={`/chat/${c.id}`}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    data-testid="chat-item"
                    className={cx(
                      "block rounded-lg py-2 pr-9 pl-2.5 hover:bg-active",
                      active && "bg-active",
                    )}
                  >
                    <span className="block truncate text-small font-medium text-text">{c.title}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-caption text-muted">
                      <span aria-hidden className={cx("size-1.5 flex-none rounded-full", STATUS_DOT[c.status] ?? STATUS_DOT.Draft)} />
                      <span className="truncate">{c.status}</span>
                      <span aria-hidden>·</span>
                      <time dateTime={c.lastActivityAt} className="flex-none">{relativeTime(c.lastActivityAt)}</time>
                    </span>
                  </Link>
                  <button
                    type="button"
                    aria-label={`Delete conversation ${c.title}`}
                    data-testid="delete-chat"
                    onClick={() => {
                      setDeleteError(null);
                      setPendingDelete(c);
                    }}
                    className="absolute top-2 right-1.5 grid size-7 place-items-center rounded-md text-faint opacity-100 hover:bg-sheet hover:text-red-ink focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                  >
                    <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.6 8.5h4.8l.6-8.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {h.nextCursor && (
          <div className="px-2 pt-2">
            <Button size="sm" variant="ghost" className="w-full" onClick={() => void h.loadMoreChats()} disabled={h.loadingMore}>
              {h.loadingMore ? "Loading…" : "Show older chats"}
            </Button>
          </div>
        )}
      </div>

      <div className="flex-none space-y-2 px-4 pt-3 pb-4 text-caption leading-[18px] text-muted">
        <p className="text-muted">Booking preparation demo. No carrier is contacted.</p>
        <p>No login. Your chats and uploads are kept in this browser only, for 7 days after your last visit. They don&apos;t sync to other devices.</p>
        <button className="text-caption font-medium text-muted underline underline-offset-2 hover:text-red-ink" onClick={() => setConfirmReset(true)}>
          Reset my data
        </button>
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete conversation?"
        body={
          <>
            <p>
              <strong className="font-medium text-text">{pendingDelete?.title}</strong> and its booking, messages and revision history will be permanently deleted. Other chats and uploads are not affected.
            </p>
            {deleteError && <p className="mt-2 text-red-ink">{deleteError}</p>}
          </>
        }
        confirmLabel="Delete conversation"
        danger
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void doDelete()}
      />
      <ConfirmDialog
        open={confirmReset}
        title="Reset all your data?"
        body="Every chat, booking and upload in this browser session will be permanently deleted and a new empty session started."
        confirmLabel="Delete everything"
        danger
        busy={resetting}
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => void doReset()}
      />
    </nav>
  );
}
