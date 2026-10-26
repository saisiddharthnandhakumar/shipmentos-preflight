"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiClientError, transcribeAudio } from "@/lib/client/api";
import { cx } from "./ui";

const MAX_SECONDS = 90;
const MIME_PREFERENCE = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

const subscribeNever = () => () => {};
const canRecord = () => typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

type Phase = "idle" | "recording" | "transcribing";
export type VoiceStatus = { text: string; tone: "info" | "error" } | null;

/**
 * Tap to talk, tap again to stop. The recording goes to Gemini speech-to-text and the words come back
 * through `onTranscript`, for the seller to read and edit before anything is sent.
 */
export function VoiceButton({ onTranscript, onStatus, disabled, className }: { onTranscript: (text: string) => void; onStatus: (s: VoiceStatus) => void; disabled?: boolean; className?: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  // Server render and first paint assume no microphone; the real answer arrives right after hydration.
  const supported = useSyncExternalStore(subscribeNever, canRecord, () => false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelled = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancelled.current = true;
      if (timer.current) clearInterval(timer.current);
      abort.current?.abort();
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const release = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  const finish = useCallback(async (mime: string) => {
    release();
    const blob = new Blob(chunks.current, { type: mime });
    chunks.current = [];
    if (cancelled.current) {
      if (alive.current) {
        setPhase("idle");
        onStatus(null);
      }
      return;
    }
    setPhase("transcribing");
    onStatus({ text: "Turning your voice into text…", tone: "info" });
    abort.current = new AbortController();
    try {
      const text = (await transcribeAudio(blob, abort.current.signal)).trim();
      if (!alive.current) return;
      if (text) {
        onTranscript(text);
        onStatus(null);
      } else onStatus({ text: "I didn't catch any speech. Tap the mic and try again.", tone: "error" });
    } catch (e) {
      if (!alive.current || (e as Error).name === "AbortError") return;
      onStatus({ text: `${e instanceof ApiClientError ? e.message : "Couldn't transcribe that."} You can type instead.`, tone: "error" });
    } finally {
      if (alive.current) setPhase("idle");
    }
  }, [onStatus, onTranscript, release]);

  async function start() {
    onStatus(null);
    cancelled.current = false;
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      const name = (e as DOMException).name;
      onStatus({
        text: name === "NotAllowedError" || name === "SecurityError" ? "Microphone access is blocked. Allow it in your browser's site settings, or type instead." : name === "NotFoundError" ? "No microphone was found. You can type instead." : "Couldn't start the microphone. You can type instead.",
        tone: "error",
      });
      return;
    }
    stream.current = s;
    const mime = MIME_PREFERENCE.find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
    recorder.current = rec;
    chunks.current = [];
    rec.ondataavailable = (ev) => ev.data.size && chunks.current.push(ev.data);
    rec.onstop = () => void finish((rec.mimeType || mime || "audio/webm").split(";")[0]);
    rec.start();
    setPhase("recording");
    const began = Date.now();
    const tick = () => {
      const secs = Math.floor((Date.now() - began) / 1000);
      onStatus({ text: `Listening… ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}. Tap the mic to stop, Esc to cancel.`, tone: "info" });
      if (secs >= MAX_SECONDS && rec.state === "recording") rec.stop();
    };
    tick();
    timer.current = setInterval(tick, 500);
  }

  function stop(cancel = false) {
    cancelled.current = cancel;
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  useEffect(() => {
    if (phase !== "recording") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && stop(true);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!supported) return null;
  const recording = phase === "recording";
  return (
    <button
      type="button"
      onClick={() => (recording ? stop() : void start())}
      disabled={disabled || phase === "transcribing"}
      aria-label={recording ? "Stop recording" : phase === "transcribing" ? "Transcribing" : "Speak your message"}
      aria-pressed={recording}
      title={recording ? "Stop recording" : "Speak instead of typing"}
      data-testid="voice-button"
      className={cx(
        "grid size-12 flex-none place-items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-55",
        recording ? "bg-red-bg text-red-ink ring-2 ring-red-line" : "bg-raised text-text hover:bg-active",
        className,
      )}
    >
      {phase === "transcribing" ? (
        <svg viewBox="0 0 24 24" className="size-5 animate-spin" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 3a9 9 0 1 0 9 9" />
        </svg>
      ) : recording ? (
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden fill="currentColor">
          <rect x="6" y="6" width="12" height="12" rx="2.5" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
        </svg>
      )}
    </button>
  );
}
