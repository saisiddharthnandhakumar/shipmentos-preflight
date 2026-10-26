"use client";

import { useState } from "react";
import { Button } from "../ui";

/** Two-step final action: the first click arms it, the second sends the booking to the company ERP outbox. */
export function SendToErpButton({ onSend, busy, size, className }: { onSend: () => void; busy: boolean; size?: "sm"; className?: string }) {
  const [armed, setArmed] = useState(false);
  if (!armed && !busy)
    return (
      <Button variant="primary" size={size} className={className} onClick={() => setArmed(true)} data-testid="confirm-draft">
        Send to ERP
      </Button>
    );
  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      <span className="text-small text-muted">Log this booking in your ERP?</span>
      <Button
        variant="primary"
        size={size}
        disabled={busy}
        onClick={() => {
          setArmed(false);
          onSend();
        }}
        data-testid="confirm-draft-yes"
      >
        {busy ? "Sending…" : "Yes, send"}
      </Button>
      <Button size={size} disabled={busy} onClick={() => setArmed(false)}>
        Not yet
      </Button>
    </span>
  );
}
