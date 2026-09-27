import Link from "@/components/navigation/nav-link";
import { AlertTriangle } from "lucide-react";

import { getTranslations } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/translator";
import type { HseAttentionDTO, HseKpiDTO } from "@/lib/modules/hse/hse.types";

/**
 * The HSE KPI row (PRD #22 §30, §31).
 *
 * A card appears only when the reader may see what it counts. A zero where a
 * permission is missing would be a claim about the world rather than about
 * their access (PRD #22 §310).
 */
export async function HseKpiGrid({ kpis }: { kpis: HseKpiDTO[] }) {
  if (kpis.length === 0) return null;
  const t = await getTranslations("hse");

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((kpi) => (
        <Link
          key={kpi.key}
          href={kpi.href}
          className="nesto-card p-5 transition-colors hover:border-line-strong"
        >
          <p className="nesto-eyebrow text-fg-subtle">{known(t, `overview.kpi.${kpi.key}`, kpi.label)}</p>
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
export async function HseAttentionList({ items }: { items: HseAttentionDTO[] }) {
  const t = await getTranslations("hse");
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
        {t("overview.needsAttention")}
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
                  {attentionText(t, item, "title")}
                </span>
                <span className="mt-0.5 block text-meta text-fg-muted">{attentionText(t, item, "detail")}</span>
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
export async function StopWorkBanner({
  records,
}: {
  records: { id: string; stopWorkNumber: string; title: string; project: { code: string } }[];
}) {
  if (records.length === 0) return null;
  const t = await getTranslations("hse");

  return (
    // Pinned under the top bar while its page scrolls, so a phone cannot flick
    // past it; capped so a long list never covers the page (AUD-04 §3, D-03-08, MW-02).
    <div
      role="alert"
      className="sticky top-[calc(3.5rem+0.5rem)] z-20 max-h-[40dvh] overflow-y-auto rounded-lg border border-danger-border bg-danger-subtle p-4 md:top-[calc(4rem+0.5rem)]"
    >
      <p className="flex items-center gap-2 text-body font-semibold text-danger-strong">
        <AlertTriangle aria-hidden="true" className="size-4" />
        {t("overview.workIsStopped")}
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

type HseT = Awaited<ReturnType<typeof getTranslations<"hse">>>;

/** A dictionary string, or the service's own English when the key is unknown. */
function known(t: HseT, key: string, fallback: string, values?: Record<string, string | number>): string {
  const text = t(key as MessageKey<"hse">, values);
  return text === key ? fallback : text;
}

/** An attention item's words, keyed by its id; the count leads its English title. */
function attentionText(t: HseT, item: HseAttentionDTO, part: "title" | "detail"): string {
  const count = Number(/^\d+/.exec(item.title)?.[0] ?? Number.NaN);
  if (part === "title" && Number.isNaN(count)) return item.title;
  const key = `overview.attention.${item.id}.${part}`;
  const text = t(key as MessageKey<"hse">, { count });
  return text === key ? item[part] : text;
}
