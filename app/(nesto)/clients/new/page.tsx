import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ClientForm } from "@/components/clients/client-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { createClientAction } from "@/lib/actions/clients";

export const metadata: Metadata = { title: "New Client" };

/**
 * Create a client (PRD #12 §39–§50).
 *
 * The optional primary contact is created in the same transaction, so a client
 * is never left half-made if the second write fails (PRD #12 §50).
 */
export default async function NewClientPage() {
  const context = await requireModule("clients");
  if (!can(context, "client.create")) notFound();

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "Clients", href: "/clients" }, { label: "New client" }]} />

      <div>
        <h1 className="text-page font-semibold text-fg">New client</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          A customer, commissioning party or organisation your company works with.
        </p>
      </div>

      <ClientForm
        mode="create"
        cancelHref="/clients/all"
        showPrimaryContact={can(context, "contact.create")}
        action={createClientAction}
        initial={{
          code: "",
          name: "",
          legalName: "",
          type: "COMPANY",
          email: "",
          phone: "",
          website: "",
          address: "",
          city: "",
          country: "",
          status: "ACTIVE",
        }}
      />
    </div>
  );
}
