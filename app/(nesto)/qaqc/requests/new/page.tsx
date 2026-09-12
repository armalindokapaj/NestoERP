import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RequestForm } from "@/components/qaqc/qaqc-forms";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createRequestAction } from "@/lib/actions/qaqc";
import * as requests from "@/lib/modules/qaqc/requests/request.service";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Request an inspection" };

/** Ask for an inspection (PRD #21 §43). */
export default async function NewRequestPage() {
  const context = await requireModule("qaqc");
  if (!can(context, "qaqc.request.create")) notFound();

  const options = await requests.requestFormOptions(context);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "QA/QC", href: "/qaqc" },
          { label: "Requests", href: "/qaqc/requests" },
          { label: "New request" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">Request an inspection</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          Asking for an inspection is not the inspection. Somebody from quality picks this up,
          carries it out and records a verdict.
        </p>
      </div>

      <RequestForm
        action={createRequestAction}
        cancelHref="/qaqc/requests"
        submitLabel="Raise request"
        pendingLabel="Raising…"
        canAssign={can(context, "qaqc.request.assign")}
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        members={options.members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName}`,
        }))}
        receipts={options.receipts.map((receipt) => ({
          value: receipt.id,
          label: `${receipt.receiptNumber} — ${receipt.supplier.name} · ${formatDate(receipt.receiptDate.toISOString())}`,
        }))}
      />
    </div>
  );
}
