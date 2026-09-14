import type { Metadata } from "next";

import { AssignmentTable } from "@/components/contractors/contractor-tables";
import { orNotFound } from "@/components/engineering/page-helpers";
import { requireModule } from "@/lib/context/current-user";
import { listContractorAssignments } from "@/lib/modules/contractors/contractor.assignments";

type Params = { params: Promise<{ contractorId: string }> };

export const metadata: Metadata = { title: "Contractor projects" };

/** Every project assignment of this contractor the reader can open (PRD #46 §27, §160). */
export default async function ContractorProjectsPage({ params }: Params) {
  const { contractorId } = await params;
  const context = await requireModule("contractors");
  const assignments = await orNotFound(listContractorAssignments(context, contractorId));
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-section font-semibold text-fg">Projects</h2>
        <p className="mt-0.5 text-table text-fg-muted">Each assignment is independent; assign a contractor from the project&apos;s Contractors tab.</p>
      </div>
      <AssignmentTable items={assignments} view="contractor" />
    </section>
  );
}
