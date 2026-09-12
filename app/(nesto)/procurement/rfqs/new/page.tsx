import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RfqForm } from "@/components/procurement/rfq-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createRfqAction } from "@/lib/actions/procurement";
import * as rfqs from "@/lib/modules/procurement/rfqs/rfq.service";

export const metadata: Metadata = { title: "New enquiry" };

/** Draft an enquiry, optionally seeded from a request's lines (PRD #19 §71). */
export default async function NewRfqPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("procurement");
  if (!can(context, "procurement.rfq.create")) notFound();

  const [options, params] = await Promise.all([rfqs.rfqFormOptions(context), searchParams]);

  const requestId = typeof params.requestId === "string" ? params.requestId : "";
  const source = options.requests.find((request) => request.id === requestId);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "Procurement", href: "/procurement" },
          { label: "Enquiries", href: "/procurement/rfqs" },
          { label: "New enquiry" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">New enquiry</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {source
            ? `Seeded from ${source.requestNumber}. Change the lines before issuing if the ask has moved on.`
            : "Ask several suppliers to price the same lines."}
        </p>
      </div>

      <RfqForm
        action={createRfqAction}
        cancelHref="/procurement/rfqs"
        submitLabel="Create enquiry"
        pendingLabel="Creating…"
        suppliers={options.suppliers.map((supplier) => ({
          value: supplier.id,
          label: supplier.code ? `${supplier.code} — ${supplier.name}` : supplier.name,
        }))}
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        requests={options.requests.map((request) => ({
          value: request.id,
          label: `${request.requestNumber} — ${request.title}`,
        }))}
        values={{
          title: source ? source.title : "",
          purchaseRequestId: requestId,
          projectId: "",
          currency: "EUR",
          responseDueDate: "",
          supplierIds: [],
          items:
            source && source.items.length > 0
              ? source.items.map((item) => ({
                  description: item.description,
                  quantity: item.quantity.toString(),
                  unit: item.unit,
                }))
              : [{ description: "", quantity: "1", unit: "each" }],
        }}
      />
    </div>
  );
}
