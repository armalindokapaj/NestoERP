import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireSettingsSection } from "../settings-access";
import { getCompany } from "@/lib/database/queries";

export const metadata: Metadata = {
  title: "Company settings",
};

export default async function CompanySettingsPage() {
  const user = await requireSettingsSection("company");
  const company = await getCompany(user.companyId);

  if (!company) notFound();

  const fields = [
    { id: "name", label: "Company name", value: company.name },
    { id: "industry", label: "Industry", value: company.industry ?? "" },
    { id: "country", label: "Country", value: company.country ?? "" },
    { id: "address", label: "Address", value: company.address ?? "" },
    { id: "email", label: "Email", value: company.email ?? "" },
    { id: "phone", label: "Phone", value: company.phone ?? "" },
    { id: "website", label: "Website", value: company.website ?? "" },
    { id: "slug", label: "Workspace identifier", value: company.slug },
  ];

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title="Company"
        description="Company identity, address and contact details."
      />

      <section className="nesto-card p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((field) => (
            <div key={field.id} className="space-y-1.5">
              <Label htmlFor={field.id}>{field.label}</Label>
              <Input id={field.id} defaultValue={field.value} readOnly disabled />
            </div>
          ))}
        </div>
        <p className="mt-4 text-meta text-fg-subtle">
          Company details are read-only in V0.1. Editing arrives with the
          settings module.
        </p>
      </section>
    </div>
  );
}
