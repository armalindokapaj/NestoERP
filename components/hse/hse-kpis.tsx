import Link from "@/components/navigation/nav-link";
import { AlertTriangle } from "lucide-react";

import type { HseAttentionDTO, HseKpiDTO } from "@/lib/modules/hse/hse.types";

/**
 * The HSE KPI row (PRD #22 §30, §31).
 *
 * A card appears only when the reader may see what it counts. A zero where a
 * permission is missing would be a claim about the world rather than about
 * their access (PRD #22 §310).
 */
export function HseKpiGrid({ kpis }: { kpis: HseKpiDTO[] }) {
  if (kpis.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((kpi) => (
        <Link
          key={kpi.key}
          href={kpi.href}
          className="nesto-card p-5 transition-colors hover:border-line-strong"
        >
          <p className="nesto-eyebrow text-fg-subtle">{kpi.label}</p>
          <p className="mt-1.5 text-page font-semibold tabular-nums text-fg">{kpi.value}</p>
        </Link>
      ))}
    </div>
  );
}

/**
 * What needs looking at, in the order a safety manager reads a morning
 * (PRD #22 §361).
 *
 * An active stop-work first, because it means people have been sent off a job
 * right now. Nothing here is decoration: an empty attention list is a good
 * morning, and it renders as nothing at all.
 */
export function HseAttentionList({ items }: { items: HseAttentionDTO[] }) {
  if (items.length === 0) return null;

  const tone: Record<HseAttentionDTO["priority"], string> = {
    CRITICAL: "border-danger-border bg-danger-subtle",
    HIGH: "border-warning-border bg-warning-subtle",
    MEDIUM: "border-line bg-surface",
  };

  const text: Record<HseAttentionDTO["priority"], string> = {
    CRITICAL: "text-danger-strong",
    HIGH: "text-warning-strong",
    MEDIUM: "text-fg",
  };

  return (
    <section aria-labelledby="hse-attention" className="space-y-2">
      <h2 id="hse-attention" className="nesto-eyebrow text-fg-subtle">
        Needs attention
      </h2>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={item.href}
              className={`flex items-start gap-3 rounded-lg border p-4 transition-opacity hover:opacity-90 ${tone[item.priority]}`}
            >
              <AlertTriangle
                aria-hidden="true"
                className={`mt-0.5 size-4 shrink-0 ${text[item.priority]}`}
              />
              <span className="min-w-0">
                <span className={`block text-table font-medium ${text[item.priority]}`}>
                  {item.title}
                </span>
                <span className="mt-0.5 block text-meta text-fg-muted">{item.detail}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The stop-work banner (PRD #22 §175, §323).
 *
 * Shown at the top of any HSE or project page where work is halted. It is the
 * one state in this module that must be impossible to scroll past.
 */
export function StopWorkBanner({
  records,
}: {
  records: { id: string; stopWorkNumber: string; title: string; project: { code: string } }[];
}) {
  if (records.length === 0) return null;

  return (
    <div
      role="alert"
      className="rounded-lg border border-danger-border bg-danger-subtle p-4"
    >
      <p className="flex items-center gap-2 text-body font-semibold text-danger-strong">
        <AlertTriangle aria-hidden="true" className="size-4" />
        Work is stopped
      </p>
      <ul className="mt-2 space-y-1">
        {records.map((record) => (
          <li key={record.id} className="text-meta">
            <Link href={`/hse/stop-work/${record.id}`} className="text-fg hover:underline">
              <span className="font-medium">{record.stopWorkNumber}</span> — {record.title}
            </Link>{" "}
            <span className="text-fg-subtle">· {record.project.code}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
