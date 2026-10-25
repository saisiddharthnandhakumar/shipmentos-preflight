"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ensureSession, ApiClientError } from "@/lib/client/api";
import type { BookingListItem, ChatListResponse } from "@/lib/client/types";

type HistoryState = {
  sessionReady: boolean;
  sessionError: string | null;
  sessionWasReset: boolean;
  chats: BookingListItem[] | null;
  chatsError: string | null;
  nextCursor: string | null;
  loadingMore: boolean;
  refreshChats: () => Promise<void>;
  loadMoreChats: () => Promise<void>;
  removeChat: (id: string) => void;
  retrySession: () => void;
  dismissReset: () => void;
};

const Ctx = createContext<HistoryState | null>(null);

export function useHistory() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useHistory outside provider");
  return v;
}

/** Session bootstrap + the Neon-backed "Previous chats" list for this anonymous browser session. */
export function HistoryProvider({ children }: { children: ReactNode }) {
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionWasReset, setSessionWasReset] = useState(false);
  const [chats, setChats] = useState<BookingListItem[] | null>(null);
  const [chatsError, setChatsError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);
  const refreshChatsRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    let alive = true;
    ensureSession(attempt > 0)
      .then(() => {
        if (!alive) return;
        setSessionReady(true);
        setSessionError(null);
        return refreshChatsRef.current();
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

  const refreshChats = useCallback(async () => {
    const my = ++seq.current;
    try {
      const r = await api<ChatListResponse>("/api/chats?limit=30");
      if (my !== seq.current) return;
      setChats(r.items);
      setNextCursor(r.nextCursor);
      setChatsError(null);
    } catch (e) {
      if (my !== seq.current) return;
      setChatsError(e instanceof ApiClientError ? e.message : "Couldn't load previous chats.");
    }
  }, []);

  const loadMoreChats = useCallback(async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const r = await api<ChatListResponse>(`/api/chats?limit=30&cursor=${encodeURIComponent(nextCursor)}`);
      setChats((prev) => [...(prev ?? []), ...r.items.filter((i) => !(prev ?? []).some((p) => p.id === i.id))]);
      setNextCursor(r.nextCursor);
    } catch (e) {
      setChatsError(e instanceof ApiClientError ? e.message : "Couldn't load more chats.");
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor]);

  useEffect(() => {
    refreshChatsRef.current = refreshChats;
  }, [refreshChats]);

  const value = useMemo<HistoryState>(
    () => ({
      sessionReady,
      sessionError,
      sessionWasReset,
      chats,
      chatsError,
      nextCursor,
      loadingMore,
      refreshChats,
      loadMoreChats,
      removeChat: (id) => setChats((prev) => prev?.filter((c) => c.id !== id) ?? prev),
      retrySession: () => setAttempt((a) => a + 1),
      dismissReset: () => setSessionWasReset(false),
    }),
    [sessionReady, sessionError, sessionWasReset, chats, chatsError, nextCursor, loadingMore, refreshChats, loadMoreChats],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
