/**
 * Where a booking is in its life, in the words the seller uses. Derived from facts we already store
 * (the rule status and whether it was sent to the ERP), so it can never drift out of step with them.
 *
 *   Completed    sent to the ERP, and not changed since
 *   Sync to ERP  all details in and sendable (Ready to submit, or Needs attention), not yet sent
 *   Draft        still being filled in or fixed (Draft, or Blocked by a Red check)
 */
export type Stage = "draft" | "sync" | "completed";
export type Tab = "all" | Stage;

export const STAGE_LABEL: Record<Stage, string> = { draft: "Draft", sync: "Sync to ERP", completed: "Completed" };
export const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "completed", label: "Completed" },
  { key: "sync", label: "Sync to ERP" },
  { key: "draft", label: "Drafts" },
];

/** Rule statuses a booking can be sent to the ERP from. */
export const SENDABLE_STATUSES = ["Ready to submit", "Needs attention"] as const;

export function stageOf(b: { status: string; confirmed: boolean }): Stage {
  if (b.confirmed) return "completed";
  return (SENDABLE_STATUSES as readonly string[]).includes(b.status) ? "sync" : "draft";
}

export const isTab = (v: string | null | undefined): v is Tab => v === "all" || v === "draft" || v === "sync" || v === "completed";
export const isISODate = (v: string | null | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
