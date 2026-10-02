import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CompanyNameForm } from "./company-name-form";
import { can } from "@/lib/access/can";
import { requireSettingsSection } from "../settings-access";
import { getCompany } from "@/lib/database/queries";
import { getCompanyOwners } from "@/lib/modules/settings/company-settings.service";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("company.metaTitle") };
}

export default async function CompanySettingsPage() {
  const user = await requireSettingsSection("company");
  const [company, owners] = await Promise.all([getCompany(user.companyId), getCompanyOwners(user)]);

  if (!company) notFound();

  const t = await getTranslations("settings");

  const canRename = can(user, "company.name.update");

  const fields = [
    ...(canRename ? [] : [{ id: "name", label: t("company.name"), value: company.name }]),
    // The company is the employing legal entity (E-01 §7, §28; ADR 0002).
    { id: "legalName", label: t("company.legalName"), value: company.legalName ?? "" },
    { id: "registrationNumber", label: t("company.registrationNumber"), value: company.registrationNumber ?? "" },
    { id: "taxNumber", label: t("company.taxNumber"), value: company.taxNumber ?? "" },
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
        {canRename ? <div className="mb-4"><CompanyNameForm name={company.name} /></div> : null}
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

      {/* D-01 §6: who owns the company, kept with its details. */}
      <section className="nesto-card p-6" aria-labelledby="company-ownership">
        <h2 id="company-ownership" className="text-card font-semibold text-fg">{t("company.ownership")}</h2>
        <p className="mt-0.5 text-meta text-fg-subtle">{t("company.ownershipDescription")}</p>
        {owners.length ? (
          <ul className="mt-4 divide-y divide-line" data-testid="company-owners">
            {owners.map((owner) => (
              <li key={owner.id} className="flex items-center justify-between gap-4 py-2.5 first:pt-0">
                <div className="min-w-0">
                  <p className="truncate text-table font-medium text-fg">{owner.holderName}</p>
                  <p className="text-meta text-fg-subtle">{[owner.isGroup ? t("company.ownershipGroup") : null, owner.holderRegistration].filter(Boolean).join(" · ")}</p>
                </div>
                <span className="shrink-0 text-table font-semibold tabular-nums text-fg">
                  <span className="sr-only">{t("company.ownershipShare")}: </span>
                  {owner.sharePercent.toLocaleString("en-US", { maximumFractionDigits: 2 })}%
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-table text-fg-subtle">{t("company.ownershipEmpty")}</p>
        )}
      </section>
    </div>
  );
}
