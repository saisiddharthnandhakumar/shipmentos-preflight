"use client";

import { useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { checkHs, suggestHs, type HsSuggestion } from "@/lib/domain/hs";
import { cx } from "../ui";

type Ai = { forDescription: string; suggestions: HsSuggestion[]; error: string | null };

function Chips({ suggestions, onUse }: { suggestions: HsSuggestion[]; onUse: (code: string) => void }) {
  return (
    <ul className="mt-1.5 flex flex-wrap gap-1.5">
      {suggestions.map((s) => (
        <li key={s.code}>
          <button type="button" onClick={() => onUse(s.code)} title={s.label} data-testid="hs-use" className="rounded-full border border-control bg-sheet px-2.5 py-1 text-caption text-text hover:bg-raised">
            <span className="num font-medium">Use {s.code}</span> <span className="text-muted">· {s.label}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Advisory check under an HS code field: flags a code that doesn't fit the product description and offers
 * likely codes in one click. It never blocks saving; the rules still only require 6+ digits.
 */
export function HsHint({ description, hsCode, onUse }: { description: string; hsCode: string; onUse: (code: string) => void }) {
  const [ai, setAi] = useState<Ai | null>(null);
  const [busy, setBusy] = useState(false);
  const desc = description.trim();
  if (desc.length < 3) return null;

  const verdict = checkHs(desc, hsCode);
  const local = suggestHs(desc);
  const aiHere = ai && ai.forDescription === desc ? ai : null;

  async function askAi() {
    setBusy(true);
    try {
      const r = await api<{ suggestions: HsSuggestion[] }>("/api/hs-suggest", { method: "POST", body: { description: desc, hsCode: hsCode || undefined } });
      setAi({ forDescription: desc, suggestions: r.suggestions, error: null });
    } catch (e) {
      setAi({ forDescription: desc, suggestions: [], error: e instanceof ApiClientError ? e.message : "Couldn't get a suggestion." });
    } finally {
      setBusy(false);
    }
  }

  if (verdict.kind === "mismatch")
    return (
      <div role="note" className="col-span-full rounded-lg bg-amber-bg px-3 py-2 text-caption text-amber-ink" data-testid="hs-warning">
        <p>
          <span className="font-medium">Check this HS code.</span> {verdict.message}
        </p>
        <Chips suggestions={verdict.suggestions} onUse={onUse} />
      </div>
    );
  if (!hsCode.trim() && local.length)
    return (
      <div className="col-span-full text-caption text-muted" data-testid="hs-suggestion">
        Suggested HS code for this product:
        <Chips suggestions={local} onUse={onUse} />
      </div>
    );
  if (verdict.kind === "unknown" && !local.length)
    return (
      <div className={cx("col-span-full text-caption text-muted")}>
        {aiHere?.suggestions.length ? (
          <>
            AI suggestions (please confirm with your invoice or the UK Trade Tariff):
            <Chips suggestions={aiHere.suggestions} onUse={onUse} />
          </>
        ) : aiHere ? (
          <span data-testid="hs-none">{aiHere.error ?? "No confident suggestion for that description."}</span>
        ) : (
          <button type="button" onClick={() => void askAi()} disabled={busy} className="underline underline-offset-2 hover:text-text disabled:opacity-60" data-testid="hs-ask-ai">
            {busy ? "Looking…" : "Suggest an HS code for this product"}
          </button>
        )}
      </div>
    );
  return null;
}
