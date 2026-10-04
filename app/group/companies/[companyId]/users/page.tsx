import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Link from "@/components/navigation/nav-link";
import { GROUP_COMPANY_API } from "@/components/platform/company-users";
import { CompanyUsersPanel } from "@/components/platform/company-users-panel";
import { requireGroupContext } from "@/lib/context/group-context";
import { prisma } from "@/lib/database/prisma";
import { getTranslations } from "@/lib/i18n/server";
import { groupActor } from "@/lib/modules/platform/group-actor";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminOrgs");
  return { title: t("companyUsers.title") };
}

type Props = { params: Promise<{ companyId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * One of the group's companies, its people managed inside it (Admin PRD #13
 * §106): the same Users surface the Platform Admin sees, answered for the
 * group's own seat. A company outside the seat's group is not found.
 */
export default async function GroupCompanyUsersPage({ params, searchParams }: Props) {
  const [{ companyId }, raw] = await Promise.all([params, searchParams]);
  const t = await getTranslations("group");
  const context = await requireGroupContext();
  const company = await prisma.company.findFirst({ where: { id: companyId, parentGroupId: context.groupId }, select: { id: true, name: true, status: true } });
  if (!company) notFound();
  const query = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  return (
      <div className="space-y-4">
        <Link href="/group/companies" className="text-table text-fg-muted hover:text-fg">{t("companies.title")}</Link>
        <h1 className="text-page font-semibold text-fg">{company.name}</h1>
        <CompanyUsersPanel actor={groupActor(context)} companyId={company.id} open={company.status === "ACTIVE"} api={GROUP_COMPANY_API} platform={false} formAction={`/group/companies/${company.id}/users`} params={query} />
      </div>
  );
}
