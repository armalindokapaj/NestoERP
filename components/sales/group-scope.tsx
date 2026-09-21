import { CompanyTag } from "@/components/workspace/company-tag";
import type { CompanyRef } from "@/lib/modules/sales/sales.types";
import { GroupCompanyFilter } from "./group-company-filter";

/**
 * What a Sales page in the Group workspace is reading (Workspace Context §45,
 * §86): the `company` filter, and the companies the figures below are drawn
 * from — so an aggregate never reads as one company's, and a company the person
 * may not read is not among them.
 */
export function GroupSalesScope({ companies, included }: { companies: CompanyRef[]; included: CompanyRef[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="group-sales-scope">
      <GroupCompanyFilter companies={companies} />
      <span className="text-meta text-fg-subtle">{included.length === 1 ? "Company" : "Across"}</span>
      {included.map((company) => (
        <CompanyTag key={company.id} name={company.name} />
      ))}
    </div>
  );
}
