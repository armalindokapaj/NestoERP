import { cn } from "@/lib/utils/cn";

/** One service's check, its words already in the reader's language. */
export type HealthCell = { key: string; service: string; state: string; stateLabel: string; detail?: string };

const DOT: Record<string, string> = { HEALTHY: "bg-success", DEGRADED: "bg-warning", DOWN: "bg-danger", UNKNOWN: "bg-fg-subtle" };

/**
 * The platform's services in one lined grid (docs/ui/UI-09-admin-console.md):
 * each its name in mono capitals, a square dot and its state, and on the
 * Health page what was checked. Home draws it without the detail.
 */
export function HealthGrid({ cells, columns = "strip" }: { cells: HealthCell[]; columns?: "strip" | "page" }) {
  return (
    <ul className={cn("grid grid-cols-2 gap-px bg-line", columns === "strip" ? "sm:grid-cols-4 xl:grid-cols-8" : "md:grid-cols-4")}>
      {cells.map((cell) => (
        <li key={cell.key} className="min-w-0 bg-surface px-4 py-3" data-state={cell.state}>
          <p className="truncate font-mono text-micro font-medium uppercase tracking-[0.1em] text-fg-subtle">{cell.service}</p>
          <p className={cn("mt-1.5 flex items-center gap-2 text-table font-medium", cell.state === "HEALTHY" ? "text-fg" : cell.state === "DOWN" ? "text-danger-strong" : "text-warning-strong")}>
            <span aria-hidden="true" className={cn("size-2 shrink-0", DOT[cell.state] ?? "bg-fg-subtle")} />
            <span className="truncate">{cell.stateLabel}</span>
          </p>
          {cell.detail ? <p className="mt-1 text-meta text-fg-muted [overflow-wrap:anywhere]">{cell.detail}</p> : null}
        </li>
      ))}
    </ul>
  );
}
