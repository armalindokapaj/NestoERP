import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RequestForm } from "@/components/procurement/request-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createRequestAction } from "@/lib/actions/procurement";
import * as requests from "@/lib/modules/procurement/requests/request.service";

export const metadata: Metadata = { title: "New purchase request" };

/** Raise a purchase request (PRD #19 §50, §51). */
export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("procurement");
  if (!can(context, "procurement.request.create")) notFound();

  const [options, params] = await Promise.all([
    requests.requestFormOptions(context),
    searchParams,
  ]);

  const projectId = typeof params.projectId === "string" ? params.projectId : "";

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "Procurement", href: "/procurement" },
          { label: "Requests", href: "/procurement/requests" },
          { label: "New request" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">New purchase request</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          It is saved as a draft. Nothing is committed until it is approved and an order is issued.
        </p>
      </div>

      <RequestForm
        action={createRequestAction}
        cancelHref="/procurement/requests"
        submitLabel="Create request"
        pendingLabel="Creating…"
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        departments={options.departments.map((department) => ({
          value: department.id,
          label: department.name,
        }))}
        members={options.members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName}`,
        }))}
        values={{
          title: "",
          description: "",
          projectId,
          departmentId: "",
          ownerMemberId: "",
          requiredDate: "",
          priority: "MEDIUM",
          currency: "EUR",
          items: [{ description: "", quantity: "1", unit: "each", estimatedUnitPrice: "" }],
        }}
      />
    </div>
  );
}
