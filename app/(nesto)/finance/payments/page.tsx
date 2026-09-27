import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Banknote } from "lucide-react";

import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { PaymentTable } from "@/components/finance/payment-table";
import { ModulePage } from "@/components/modules/module-page";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { getTranslations } from "@/lib/i18n/server";
import type { UserContext } from "@/lib/context/types";
import { parsePaymentQuery } from "@/lib/modules/finance/finance.query";
import * as payments from "@/lib/modules/finance/payments/payment.service";
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";
import { PAYMENT_SORT_KEYS } from "@/lib/modules/finance/payments/payment.schema";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance");
  return { title: t("meta.payments") };
}

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Payments (PRD #15 §165, §166).
 *
 * There is no "new payment" control here: a payment always settles a specific
 * invoice or expense, and it is recorded from that record — which is where the
 * outstanding balance is (PRD #15 §82).
 */
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("finance");

  if (!can(context, "finance.payment.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "finance");
  const params = await searchParams;

  return (
    <ModulePage experience={experience} activeSection="payments">
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <PaymentsList context={context} searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}

async function PaymentsList({
  context,
  searchParams,
}: {
  context: UserContext;
  searchParams: SearchParams;
}) {
  const t = await getTranslations("finance");
  const query = parsePaymentQuery(searchParams);
  const result = await payments.listPayments(context, query);
  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) {
    redirect(listPageRedirect("/finance/payments", searchParams, result.pagination.page));
  }

  const hasFilters = Boolean(
    query.search || query.direction?.length || query.status?.length || query.method?.length,
  );

  const buildHref = (page: number) => pageHref("/finance/payments", searchParams, page);

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder={t("payments.search")}
        filters={[
          {
            param: "direction",
            label: t("payments.direction"),
            options: [
              { value: "RECEIPT", label: t("paymentRow.received") },
              { value: "DISBURSEMENT", label: t("paymentRow.paidOut") },
            ],
          },
          {
            param: "status",
            label: t("columns.status"),
            options: [
              { value: "RECORDED", label: t("paymentStatus.RECORDED") },
              { value: "VOIDED", label: t("paymentStatus.VOIDED") },
            ],
          },
          {
            param: "method",
            label: t("columns.method"),
            options: [
              { value: "BANK_TRANSFER", label: t("method.BANK_TRANSFER") },
              { value: "CARD", label: t("method.CARD") },
              { value: "CASH", label: t("method.CASH") },
              { value: "CHECK", label: t("method.CHECK") },
              { value: "OTHER", label: t("method.OTHER") },
            ],
          },
        ]}
        sortOptions={[
          { value: "date-desc", label: t("sort.newest") },
          { value: "date-asc", label: t("sort.oldest") },
          { value: "amount-desc", label: t("sort.largest") },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<Banknote />}
            title={t("payments.noMatch")}
            description={t("list.noMatchBody")}
            action={{ label: t("list.clearFilters"), href: "/finance/payments" }}
          />
        ) : (
          <EmptyState
            icon={<Banknote />}
            title={t("payments.none")}
            description={t("payments.noneBody")}
          />
        )
      ) : (
        <>
          <PaymentTable payments={result.data} sort={{ value: query.sort, keys: PAYMENT_SORT_KEYS }} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
