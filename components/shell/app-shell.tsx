"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Button, Drawer, Notice, cx } from "../ui";
import { HistoryProvider, useHistory } from "./history-context";
import { HistorySidebar, LogoMark } from "./history-sidebar";
import { NAV } from "./nav";
import { ThemeToggle } from "./theme-toggle";

const RAIL_KEY = "shipmentos.rail-collapsed";

// Per-viewer UI preference only (never data): kept in localStorage, wrapped for private windows.
const railListeners = new Set<() => void>();
let railMemory = false;
function readRail(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === "1";
  } catch {
    return railMemory;
  }
}
function writeRail(v: boolean) {
  railMemory = v;
  try {
    localStorage.setItem(RAIL_KEY, v ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
  railListeners.forEach((l) => l());
}
function subscribeRail(l: () => void) {
  railListeners.add(l);
  return () => railListeners.delete(l);
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <HistoryProvider>
      <Shell>{children}</Shell>
    </HistoryProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const h = useHistory();
  const collapsed = useSyncExternalStore(subscribeRail, readRail, () => false);
  const [drawer, setDrawer] = useState(false);
  const toggleRail = () => writeRail(!collapsed);

  return (
    <div className="flex h-dvh min-h-0 bg-frame">
      <a href="#main" className="sr-only z-50 rounded-lg bg-sheet px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to main content
      </a>
      {/* Desktop rail: part of the tinted L-frame */}
      <aside
        className={cx("hidden min-h-0 flex-none flex-col lg:flex", collapsed ? "w-0 overflow-hidden" : "w-[248px]")}
        aria-hidden={collapsed || undefined}
        data-testid="history-rail"
      >
        {!collapsed && <HistorySidebar />}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 flex-none items-center gap-2 px-2 lg:px-3">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            className="grid size-9 place-items-center rounded-lg text-muted hover:bg-active lg:hidden"
            aria-label="Open chat history"
            data-testid="open-history"
          >
            <svg viewBox="0 0 16 16" className="size-4" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2.5 4h11M2.5 8h11M2.5 12h11" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={toggleRail}
            className="hidden size-9 place-items-center rounded-lg text-muted hover:bg-active lg:grid"
            aria-label={collapsed ? "Show chat history" : "Hide chat history"}
            aria-pressed={!collapsed}
            data-testid="toggle-rail"
          >
            <svg viewBox="0 0 16 16" className="size-4" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="2.5" width="12" height="11" rx="2" />
              <path d="M6 2.5v11" />
            </svg>
          </button>
          {collapsed && (
            <span className="hidden items-center gap-2 pr-2 lg:flex">
              <LogoMark className="size-5" />
              <span translate="no" className="text-sm font-semibold text-ink">ShipmentOS</span>
            </span>
          )}
          <span className="flex items-center gap-2 lg:hidden">
            <LogoMark className="size-5" />
          </span>
          <nav aria-label="Mode" className="flex h-12 min-w-0 items-stretch gap-1 overflow-x-auto pr-2 lg:hidden">
            {NAV.map((m) => {
              const active = m.match(pathname);
              return (
                <Link
                  key={m.href}
                  href={m.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "relative flex flex-none items-center px-2.5 text-small font-medium whitespace-nowrap",
                    active ? "text-text" : "text-muted hover:text-text",
                  )}
                >
                  {m.label}
                  {active && <span aria-hidden className="absolute inset-x-2.5 bottom-0 h-0.5 rounded-full bg-accent" />}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex flex-none items-center">
            <ThemeToggle />
          </div>
        </header>

        <main id="main" tabIndex={-1} className="min-h-0 flex-1 outline-none lg:pr-2 lg:pb-2">
          <div className="flex h-full min-h-0 flex-col overflow-hidden border-border bg-sheet lg:rounded-2xl lg:border">
            {h.sessionError ? (
              <div className="m-auto max-w-md p-6 text-center">
                <h1 className="text-heading">We couldn&apos;t start your session</h1>
                <p className="mt-2 text-sm text-muted">{h.sessionError} Your existing data (if any) is safe.</p>
                <Button variant="primary" className="mt-4" onClick={h.retrySession}>
                  Try again
                </Button>
              </div>
            ) : (
              <>
                {h.sessionWasReset && (
                  <div className="p-3 pb-0">
                    <Notice tone="warn" action={<button className="underline" onClick={h.dismissReset}>Dismiss</button>}>
                      Your previous session had expired, so a new one was started. Earlier chats and uploads from that session are no longer available in this browser.
                    </Notice>
                  </div>
                )}
                {children}
              </>
            )}
          </div>
        </main>
      </div>

      <Drawer open={drawer} onClose={() => setDrawer(false)} label="Chat history" side="left">
        <div className="h-full bg-frame">
          <HistorySidebar onNavigate={() => setDrawer(false)} />
        </div>
      </Drawer>
    </div>
  );
}
