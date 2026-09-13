import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireSettingsSection } from "../settings-access";
import { getCompany } from "@/lib/database/queries";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("company.metaTitle") };
}

export default async function CompanySettingsPage() {
  const user = await requireSettingsSection("company");
  const company = await getCompany(user.companyId);

  if (!company) notFound();

  const t = await getTranslations("settings");

  const fields = [
    { id: "name", label: t("company.name"), value: company.name },
    { id: "industry", label: t("company.industry"), value: company.industry ?? "" },
    { id: "country", label: t("company.country"), value: company.country ?? "" },
    { id: "address", label: t("company.address"), value: company.address ?? "" },
    { id: "email", label: t("company.email"), value: company.email ?? "" },
    { id: "phone", label: t("company.phone"), value: company.phone ?? "" },
    { id: "website", label: t("company.website"), value: company.website ?? "" },
    { id: "slug", label: t("company.slug"), value: company.slug },
  ];

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title={t("sections.company.label")}
        description={t("sections.company.description")}
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
        <p className="mt-4 text-meta text-fg-subtle">{t("company.readOnly")}</p>
      </section>
    </div>
  );
}
