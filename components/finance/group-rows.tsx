import type * as React from "react";
import { Building2 } from "lucide-react";

import type { TableColumn } from "@/components/data/data-table";
import { CompanyRecordLink } from "@/components/workspace/company-record-link";
import { CompanyTag } from "@/components/workspace/company-tag";
import { EmptyState } from "@/components/ui/empty-state";
import { getTranslations } from "@/lib/i18n/server";
import type { CompanyRef } from "@/lib/modules/finance/finance.types";

/**
 * What a finance row needs in the Group workspace (Workspace Context §31, §45).
 *
 * A row read there names its company, and its record is a company page: the
 * link opens it through `CompanyRecordLink`, which enters that company's
 * workspace first, so a group header never sits over one company's record.
 */

/** The Company column. Only a grouped table adds it, so a company workspace's tables are unchanged. */
export function companyColumn<T extends { company?: CompanyRef }>(label = "Company"): TableColumn<T> {
  return {
    key: "company",
    label,
    render: (row) => (row.company ? <CompanyTag name={row.company.name} /> : null),
  };
}

/** The primary cell of a grouped row: the same link `DataTable` makes, through the company hop. */
export function GroupRecordLink({ company, href, children }: { company: CompanyRef; href: string; children: React.ReactNode }) {
  return (
    <CompanyRecordLink
      companyId={company.id}
      companyName={company.name}
      href={href}
      className="font-medium text-fg transition-colors hover:text-accent focus-visible:text-accent"
    >
      {children}
    </CompanyRecordLink>
  );
}

/** The Group workspace reads no company here: an empty answer, not an error (Workspace Context §76). */
export async function NoAccessibleData() {
  const t = await getTranslations("finance");
  return (
    <EmptyState
      icon={<Building2 />}
      title={t("group.noAccessTitle")}
      description={t("group.noAccessBody")}
    />
  );
}
