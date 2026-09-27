import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";

import { ContractRequestQueue } from "@/components/contracts/unit-contract/contract-request-queue";
import { Pagination } from "@/components/data/pagination";
import { ModulePage } from "@/components/modules/module-page";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { legalCapabilities } from "@/lib/modules/contracts/units/sale-contract";
import { parseContractRequestQuery } from "@/lib/modules/contracts/units/unit-contract.schema";
import { listContractRequests } from "@/lib/modules/contracts/units/unit-contract.service";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contracts");
  return { title: t("meta.unitContractRequests") };
}

/** Sales' requests for a unit's contract, waiting for Legal (E-05F §12). */
export default async function ContractRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireModule("contracts");
  const caps = legalCapabilities(context);
  if (!caps.canView || !(caps.canCreate || caps.canReview)) redirect("/access-denied");
  const params = await searchParams;
  const query = parseContractRequestQuery(params);
  const list = await listContractRequests(context, query);
  // Every request is reachable page by page — the queue no longer stops silently at 50 (AUD-08 §4, DT-05).
  if (list.page !== query.page) redirect(listPageRedirect("/contracts/requests", params, list.page));
  return (
    <ModulePage experience={resolveModuleExperience(context, "contracts")} activeSection="requests">
      <div className="space-y-4">
        <ContractRequestQueue items={list.items} view={query.view} canCreate={caps.canCreate} canDecline={caps.canReview} />
        <Pagination
          meta={{ page: list.page, limit: list.pageSize, total: list.total, totalPages: Math.max(1, Math.ceil(list.total / list.pageSize)) }}
          buildHref={(next) => pageHref("/contracts/requests", params, next)}
        />
      </div>
    </ModulePage>
  );
}
