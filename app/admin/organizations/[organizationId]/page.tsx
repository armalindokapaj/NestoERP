import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AccessError } from "@/lib/access/guards";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { getPlatformCompanyOverview } from "@/lib/modules/platform/platform-company.service";
import { getGroupImplementation } from "@/lib/modules/platform/platform-implementation.service";
import { CompanyDetail } from "../_detail/company-detail";
import { GroupDetail } from "../_detail/group-detail";

export const metadata: Metadata = { title: "Organization" };

type Props = { params: Promise<{ organizationId: string }> };

const orNull = <T,>(promise: Promise<T>) => promise.catch((error: unknown) => {
  if (error instanceof AccessError && error.code === "NOT_FOUND") return null;
  throw error;
});

/**
 * One organization address for either kind (Admin IA §7): a Parent Group or a
 * company, standalone or not. A standalone company's hidden root is never a
 * group here, so its id finds nothing.
 */
export default async function OrganizationPage({ params }: Props) {
  const { organizationId } = await params;
  const context = await requirePlatformContext();
  const group = await orNull(getGroupImplementation(context, organizationId));
  if (group) return <GroupDetail implementation={group} />;
  const company = await orNull(getPlatformCompanyOverview(context, organizationId));
  if (company) return <CompanyDetail overview={company} />;
  notFound();
}
