"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

import { useTablePreferences } from "@/components/data/use-table-preferences";
import { useRouter } from "@/components/navigation/guarded-router";
import { useNavigationFeedback } from "@/components/navigation/navigation-feedback";
import { applyListChange, queryHref, sameQuery } from "@/lib/tables/list-url";
import { effectivePageSize } from "@/lib/tables/preferences";
import { useTranslations } from "@/components/i18n/i18n-provider";

/**
 * Rows per page (AUD-08 §4, §5, DT-05, DT-09).
 *
 * Offers only the sizes the module supports, writes the choice to the URL —
 * returning to page 1 — and remembers it for this list on this device. A
 * remembered size is applied once, by replacing the address, only when the URL
 * names no `limit`: an explicit URL value always wins, and a remembered size
 * the list no longer offers is ignored. The server still enforces its ceiling.
 */
export function PageSizeSelect({
  listId,
  sizes,
  current,
  param = "limit",
}: {
  listId?: string;
  sizes: readonly number[];
  /** The limit the server applied to the rows on screen. */
  current: number;
  param?: string;
}) {
  const t = useTranslations("ui");
  const router = useRouter();
  const feedback = useNavigationFeedback();
  const searchParams = useSearchParams();
  const preferences = useTablePreferences(listId);
  const [pending, startTransition] = React.useTransition();
  const restored = React.useRef(false);

  const go = React.useCallback(
    (size: number, mode: "push" | "replace") => {
      const now = searchParams.toString();
      const query = applyListChange(now, { [param]: String(size) });
      if (sameQuery(now, query)) return;
      const href = queryHref(query);
      if (mode === "push") feedback?.begin(href, "record");
      startTransition(() => (mode === "push" ? router.push(href, { scroll: false }) : router.replace(href, { scroll: false })));
    },
    [searchParams, param, router, feedback],
  );

  React.useEffect(() => {
    if (restored.current || !preferences.ready) return;
    restored.current = true;
    const effective = effectivePageSize(searchParams.get(param), preferences.stored, sizes);
    if (effective.source === "preference" && effective.size !== null && effective.size !== current) go(effective.size, "replace");
  }, [preferences.ready, preferences.stored, searchParams, param, sizes, current, go]);

  const id = React.useId();
  return (
    <div className="flex items-center gap-2" data-pending={pending || undefined}>
      <label htmlFor={id} className="text-table text-fg-subtle">
        {t("rowsPerPage")}
      </label>
      <select
        id={id}
        // 44px and 16px text under a touch layout or pointer (AUD-04 §3, SP-04).
        className="h-9 rounded-md border border-line bg-surface px-2 text-table font-medium text-fg-muted transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20 touch:h-11 max-md:text-base"
        value={sizes.includes(current) ? String(current) : ""}
        onChange={(event) => {
          const size = Number(event.target.value);
          if (!sizes.includes(size)) return;
          preferences.update((stored) => ({ ...stored, pageSize: size }));
          go(size, "push");
        }}
      >
        {sizes.includes(current) ? null : <option value="">{current}</option>}
        {sizes.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </select>
    </div>
  );
}
