import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EmployeeDocuments } from "@/components/hr/employee-documents";
import { AccessError } from "@/lib/access/guards";
import { listEmployeeDocuments } from "@/lib/modules/hr/documents/employee-document.service";
import { loadEmployee } from "../../employee-context";
import { getTranslations } from "@/lib/i18n/server";

type Params = { params: Promise<{ employeeId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hr");
  return { title: t("meta.employeeDocuments") };
}

/**
 * The employment file (PRD #16 §133, §135; E-02 §94-§99).
 *
 * Reached with `hr.document.view` plus `hr.employee.view` — or, for one's own
 * record only, `hr.self.documents`. Which files each reader opens is the
 * employee-file policy's, applied in the query (E-02 §105-§111): the same list
 * the person's profile shows. `?document=` opens one, as HR's worklists link.
 */
export default async function EmployeeDocumentsTabPage({ params, searchParams }: Params) {
  const { employeeId } = await params;
  const { context, employee } = await loadEmployee(employeeId, "/documents");

  if (!employee.capabilities.canViewDocuments) notFound();
  const focus = (await searchParams).document;
  const data = await listEmployeeDocuments(context, employee.id).catch((error: unknown) => {
    if (error instanceof AccessError) notFound();
    throw error;
  });

  const t = await getTranslations("hr");
  return (
    <div className="space-y-5">
      <EmployeeDocuments data={data} heading={false} focusId={typeof focus === "string" ? focus : undefined} />
    </div>
  );
}
