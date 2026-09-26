import { FilterX } from "lucide-react";

import type { FilterOption } from "@/components/data/list-toolbar";
import { EmptyState } from "@/components/ui/empty-state";
import { getTranslations } from "@/lib/i18n/server";

/**
 * Small pieces the invoice and expense registers share (AUD-01 §5.1, §9).
 */

/**
 * A filter's options, plus one for the combination in force when the address
 * asks for several values (`settlement=PAID,PARTIALLY_PAID`). The toolbar picks
 * one value per filter; without this it would show "Settlement" — no filter —
 * over a list that is filtered.
 */
export function combinedOption(options: FilterOption[], selected: readonly string[] | undefined): FilterOption[] {
  if (!selected || selected.length < 2) return options;
  const label = selected.map((value) => options.find((option) => option.value === value)?.label ?? value).join(" or ");
  return [{ value: selected.join(","), label }, ...options];
}

/** The register with no filters, in the same mode: clearing filters never leaves the archive (AUD-01 §9). */
export function registerHref(basePath: string, archived: boolean): string {
  return archived ? `${basePath}?archived=1` : basePath;
}

/** A date filter that is not a date, or a range that ends before it starts: refused, and said so. */
export async function InvalidRegisterFilters({ href }: { href: string }) {
  const t = await getTranslations("financeRegister");
  return (
    <EmptyState
      icon={<FilterX />}
      title={t("invalidFiltersTitle")}
      description={t("invalidFiltersDescription")}
      action={{ label: t("clearFilters"), href }}
    />
  );
}
