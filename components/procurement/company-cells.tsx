import type { TableColumn } from "@/components/data/data-table";
import { CompanyRecordLink } from "@/components/workspace/company-record-link";
import { CompanyTag } from "@/components/workspace/company-tag";
import type { CompanyRef } from "@/lib/modules/procurement/procurement.types";

/**
 * How a Procurement row shows its company in the Group workspace (Workspace
 * Context §31, §45).
 *
 * A row read in the Group workspace carries its `company`; one read in a company
 * workspace does not, and every helper here then renders exactly what it did
 * before — so the same table serves both without asking which one it is in.
 */

/** The row's company as a column: a tag in the Group workspace, absent otherwise. */
export function companyColumn<T extends { company?: CompanyRef }>(): TableColumn<T> {
  return {
    key: "company",
    label: "Company",
    render: (row) => (row.company ? <CompanyTag name={row.company.name} /> : null),
  };
}

/**
 * A row's own link. Every record page is one company's, so from the Group
 * workspace opening it enters that company first (`CompanyRecordLink`); in a
 * company workspace the table's ordinary row link is used and this passes its
 * children through.
 */
export function RecordLink({
  company,
  href,
  children,
}: {
  company: CompanyRef | undefined;
  href: string;
  children: React.ReactNode;
}) {
  if (!company) return <>{children}</>;
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

/** Whether a set of rows was read in the Group workspace. */
export function isGroupRows(rows: { company?: CompanyRef }[]): boolean {
  return rows.some((row) => row.company !== undefined);
}
