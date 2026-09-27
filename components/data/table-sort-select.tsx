"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

import { useRouter } from "@/components/navigation/guarded-router";
import { useNavigationFeedback } from "@/components/navigation/navigation-feedback";
import type { TableSortConfig } from "@/components/data/sort-header";
import { applyListChange, queryHref, sameQuery } from "@/lib/tables/list-url";
import { appliedSort, type SortChoice } from "@/lib/tables/sort";
import { cn } from "@/lib/utils/cn";
import { useTranslations } from "@/components/i18n/i18n-provider";

/**
 * The phone Sort control of a table (AUD-04 §5, MW-06).
 *
 * Below `md` the table header — and with it every header sort control — is
 * replaced by cards, so the same orders are offered here as one labelled
 * select. The options come from the columns' `sortKey` and the list's
 * allowlist (`sortChoices`); the selected option names the applied sort and
 * its direction. Choosing one writes the URL exactly as a header click does:
 * page 1, the guarded router (AUD-03 §5), navigation feedback (NAV-01).
 *
 * Where the page's toolbar already offers a Sort control (`ListToolbar
 * sortOptions`, marked `data-list-sort-control`), this one stays out of the
 * way, so a phone never shows two.
 */
export function TableSortSelect({ choices, sort, label }: { choices: SortChoice[]; sort: TableSortConfig; label?: string }) {
  const t = useTranslations("ui");
  const router = useRouter();
  const feedback = useNavigationFeedback();
  const searchParams = useSearchParams();
  const param = sort.param ?? "sort";
  const [pending, startTransition] = React.useTransition();
  const id = React.useId();

  const applied = appliedSort(sort.value, searchParams.get(param), sort.keys, sort.defaultValue) ?? "";
  const known = choices.some((choice) => choice.value === applied);

  function choose(value: string) {
    if (!value || pending) return;
    const current = searchParams.toString();
    const query = applyListChange(current, { [param]: value });
    if (sameQuery(current, query)) return;
    const href = queryHref(query);
    feedback?.begin(href, "record");
    startTransition(() => router.push(href, { scroll: false }));
  }

  return (
    <div
      className={cn("flex min-w-0 flex-1 items-center gap-2 md:hidden", "[:root:has([data-list-sort-control])_&]:hidden")}
      data-table-sort
      data-pending={pending || undefined}
    >
      <label htmlFor={id} className="shrink-0 text-table font-medium text-fg-subtle">
        {t("sort")}
      </label>
      <select
        id={id}
        aria-label={label ? t("sortLabel", { label }) : t("sort")}
        className="h-11 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-base font-medium text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20"
        value={known ? applied : ""}
        onChange={(event) => choose(event.target.value)}
      >
        {known ? null : <option value="">{t("listOrder")}</option>}
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </div>
  );
}
