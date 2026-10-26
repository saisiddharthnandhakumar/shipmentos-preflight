"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ensureSession, ApiClientError } from "@/lib/client/api";

type HistoryState = {
  sessionReady: boolean;
  sessionError: string | null;
  sessionWasReset: boolean;
  retrySession: () => void;
  dismissReset: () => void;
};

const Ctx = createContext<HistoryState | null>(null);

export function useHistory() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useHistory outside provider");
  return v;
}

/** Session bootstrap for this anonymous browser session. */
export function HistoryProvider({ children }: { children: ReactNode }) {
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionWasReset, setSessionWasReset] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    ensureSession(attempt > 0)
      .then(() => {
        if (!alive) return;
        setSessionReady(true);
        setSessionError(null);
      })
      .catch((e: ApiClientError) => alive && setSessionError(e.message || "Couldn't start a session."));
    return () => {
      alive = false;
    };
  }, [attempt]);

  useEffect(() => {
    const onReset = () => setSessionWasReset(true);
    window.addEventListener("shipmentos:session-reset", onReset);
    return () => window.removeEventListener("shipmentos:session-reset", onReset);
  }, []);

  const value = useMemo<HistoryState>(
    () => ({
      sessionReady,
      sessionError,
      sessionWasReset,
      retrySession: () => setAttempt((a) => a + 1),
      dismissReset: () => setSessionWasReset(false),
    }),
    [sessionReady, sessionError, sessionWasReset],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
