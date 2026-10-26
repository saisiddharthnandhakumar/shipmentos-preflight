"use client";

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

let sessionPromise: Promise<void> | null = null;

/** Create or resume the anonymous session (HttpOnly cookie; nothing secret is visible to JS). */
export function ensureSession(force = false): Promise<void> {
  if (!sessionPromise || force) {
    sessionPromise = fetch("/api/session", { method: "POST", credentials: "same-origin" }).then(async (r) => {
      if (!r.ok) {
        sessionPromise = null;
        const body = await r.json().catch(() => null);
        throw new ApiClientError(r.status, body?.error?.code ?? "SESSION_FAILED", body?.error?.message ?? "Couldn't start a session.");
      }
    });
  }
  return sessionPromise;
}

type Opts = { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal };

/**
 * JSON API helper. If the session expired, it starts a fresh one and retries once — the old
 * session's private data is NOT recovered (there are no accounts), which callers surface in the UI.
 */
export async function api<T>(path: string, opts: Opts = {}, retried = false): Promise<T> {
  await ensureSession();
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? "GET",
      credentials: "same-origin",
      headers: opts.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      signal: opts.signal,
      cache: "no-store",
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiClientError(0, "NETWORK", "Network problem — check your connection and retry. Nothing was saved.");
  }
  if (res.ok) return (await res.json()) as T;
  const body = await res.json().catch(() => null);
  const code = body?.error?.code ?? "HTTP_" + res.status;
  if (res.status === 401 && code === "SESSION_REQUIRED" && !retried) {
    await ensureSession(true);
    window.dispatchEvent(new CustomEvent("shipmentos:session-reset"));
    return api<T>(path, opts, true);
  }
  throw new ApiClientError(res.status, code, body?.error?.message ?? `Request failed (${res.status}).`, body?.error?.details);
}

export function newRequestId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/** Send a voice recording to Gemini speech-to-text; resolves to the words (possibly empty). */
export async function transcribeAudio(blob: Blob, signal?: AbortSignal): Promise<string> {
  await ensureSession();
  let res: Response;
  try {
    res = await fetch("/api/transcribe", { method: "POST", credentials: "same-origin", headers: { "content-type": blob.type || "audio/webm" }, body: blob, signal, cache: "no-store" });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiClientError(0, "NETWORK", "Network problem — check your connection and try again.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiClientError(res.status, body?.error?.code ?? "HTTP_" + res.status, body?.error?.message ?? `Couldn't transcribe that (${res.status}).`);
  return String(body?.text ?? "");
}
