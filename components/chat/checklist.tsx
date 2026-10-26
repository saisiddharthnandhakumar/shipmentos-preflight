import type { Checklist as ChecklistData } from "@/lib/domain/checklist";
import { cx } from "../ui";

/** Every detail the checks need, in the order we ask for it, ticked off as it arrives. */
export function Checklist({ data }: { data: ChecklistData }) {
  const numberOf = new Map(data.groups.flatMap((g) => g.rows).map((r, i) => [r.key, i + 1]));
  return (
    <section aria-labelledby="checklist-h" data-testid="checklist" data-complete={data.complete} data-done={data.done} data-total={data.total}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="checklist-h" className="text-card text-text">
          Details checklist
        </h3>
        <span className="num text-small text-muted" data-testid="checklist-count">
          {data.done} of {data.total}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised" role="progressbar" aria-label="Details provided" aria-valuemin={0} aria-valuemax={data.total} aria-valuenow={data.done}>
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${data.total ? (data.done / data.total) * 100 : 0}%` }} />
      </div>
      <ol className="mt-3 space-y-0.5">
        {data.groups.flatMap((g) => [
          g.title ? (
            <li key={`${g.id}-title`} className="list-none pt-2 pb-0.5 pl-8 text-caption font-medium text-muted">
              {g.title}
              <span className="num ml-1.5 font-normal">
                {g.rows.filter((r) => r.done).length}/{g.rows.length}
              </span>
            </li>
          ) : null,
          ...g.rows.map((r) => {
            return (
              <li key={r.key} data-key={r.key} data-done={r.done} className={cx("flex items-center gap-2.5 rounded-lg px-1 py-1", r.next && !r.done && "bg-raised")}>
                <span className={cx("grid size-5 flex-none place-items-center rounded-full border", r.done ? "border-accent bg-accent text-on-accent" : "border-control text-transparent")} aria-hidden>
                  <svg viewBox="0 0 12 12" className="size-3">
                    <path d="M2.5 6.3 5 8.6 9.5 3.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className="num w-5 flex-none text-right text-caption text-faint">{numberOf.get(r.key)}</span>
                <span className={cx("min-w-0 flex-1 text-small", r.done ? "text-muted line-through decoration-faint/60" : "text-text")}>
                  {r.label}
                  <span className="sr-only">{r.done ? " — provided" : " — still needed"}</span>
                </span>
                {r.next && !r.done && <span className="flex-none rounded-full bg-accent px-2 py-0.5 text-caption font-medium text-on-accent">Next</span>}
              </li>
            );
          }),
        ])}
      </ol>
    </section>
  );
}
