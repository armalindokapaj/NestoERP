"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/components/navigation/guarded-router";

import type { CompanyRef } from "@/lib/modules/sales/sales.types";
import { cn } from "@/lib/utils/cn";
import { useSalesTranslations } from "@/components/sales/sales-text";
import { FormSelect } from "@/components/ui/form-select";

/**
 * The `company` filter of a Sales page in the Group workspace (Workspace Context
 * §86, §87).
 *
 * A filter, not the workspace: it narrows what the group already reads and
 * writes only the `company` query parameter. The options are the companies the
 * server resolved for this person; whatever else the URL says, the server
 * checks it against the same list and ignores what is not there.
 */
export function GroupCompanyFilter({ companies, className }: { companies: CompanyRef[]; className?: string }) {
  const t = useSalesTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = React.useTransition();

  if (companies.length < 2) return null;

  function change(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set("company", value);
    else next.delete("company");
    next.delete("page");
    const query = next.toString();
    startTransition(() => router.push(query ? `?${query}` : "?", { scroll: false }));
  }

  return (
    <FormSelect
      aria-label={t("common.company")}
      value={searchParams.get("company") ?? ""}
      onChange={(event) => change(event.target.value)}
      className={cn(
        "h-10 rounded-md border border-line bg-surface px-3 text-table font-medium text-fg-muted transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20",
        className,
      )}
    >
      <option value="">{t("common.allCompanies")}</option>
      {companies.map((company) => (
        <option key={company.id} value={company.id}>
          {company.name}
        </option>
      ))}
    </FormSelect>
  );
}
