"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { api, ensureSession } from "@/lib/client/api";
import { ConfirmDialog, cx } from "../ui";
import { NAV } from "./nav";

export function LogoMark({ className }: { className?: string }) {
  // A pallet seen from the side: three deck boards over three blocks. Lime deck, lavender blocks.
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <rect x="2" y="3" width="20" height="13" rx="4" fill="#d6ee6f" />
      <path d="M6 7.5h12M6 11.5h8" stroke="#1c1c1c" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="3" y="18" width="5" height="3" rx="1.5" fill="#b9b0ef" />
      <rect x="9.5" y="18" width="5" height="3" rx="1.5" fill="#b9b0ef" />
      <rect x="16" y="18" width="5" height="3" rx="1.5" fill="#b9b0ef" />
    </svg>
  );
}

export function HistorySidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function doReset() {
    setResetting(true);
    try {
      await api("/api/session", { method: "DELETE" });
      try {
        localStorage.removeItem("shipmentos.sampled");
      } catch {
        /* storage unavailable */
      }
      await ensureSession(true);
      window.location.replace(new URL("/dashboard", window.location.origin).href);
    } catch {
      setResetting(false);
      setConfirmReset(false);
    }
  }

  return (
    <nav aria-label="Main" className="flex h-full min-h-0 flex-col">
      <div className="flex h-16 flex-none items-center gap-2 px-5">
        <Link href="/dashboard" onClick={onNavigate} className="flex items-center gap-2 rounded-md" aria-label="ShipmentOS home">
          <LogoMark className="size-6" />
          <span translate="no" className="text-card text-ink">ShipmentOS</span>
        </Link>
        <span className="ml-auto text-caption text-faint">UK → EU</span>
      </div>
      <div className="px-4 pt-1 pb-3">
        <Link
          href="/new"
          onClick={onNavigate}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-ink text-sm font-medium text-app transition-opacity hover:opacity-90"
          data-testid="new-chat"
        >
          <span aria-hidden className="text-base leading-none">+</span> New booking
        </Link>
      </div>

      <ul className="space-y-1 px-4 pb-2" aria-label="Sections">
        {NAV.map((n) => {
          const on = n.match(pathname);
          return (
            <li key={n.href}>
              <Link
                href={n.href}
                onClick={onNavigate}
                aria-current={on ? "page" : undefined}
                className={cx("flex h-11 items-center gap-3 rounded-full px-4 text-sm transition-colors", on ? "bg-accent font-medium text-on-accent" : "text-muted hover:bg-active hover:text-text")}
              >
                {n.icon}
                {n.label}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="min-h-0 flex-1" />

      <div className="flex-none space-y-2 px-6 pt-3 pb-5 text-caption leading-[18px] text-muted">
        <p className="text-muted">Booking preparation demo. No carrier is contacted.</p>
        <p>No login. Your bookings and uploads are kept in this browser only, for 7 days after your last visit. They don&apos;t sync to other devices.</p>
        <button className="text-caption font-medium text-muted underline underline-offset-2 hover:text-red-ink" onClick={() => setConfirmReset(true)}>
          Reset my data
        </button>
      </div>

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
