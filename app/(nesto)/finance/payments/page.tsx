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
import type { UserContext } from "@/lib/context/types";
import { parsePaymentQuery } from "@/lib/modules/finance/finance.query";
import * as payments from "@/lib/modules/finance/payments/payment.service";

export const metadata: Metadata = { title: "Payments" };

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
  const query = parsePaymentQuery(searchParams);
  const result = await payments.listPayments(context, query);

  const hasFilters = Boolean(
    query.search || query.direction?.length || query.status?.length || query.method?.length,
  );

  function buildHref(page: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === "string" && key !== "page") params.set(key, value);
    }
    if (page > 1) params.set("page", String(page));
    const search = params.toString();
    return search ? `/finance/payments?${search}` : "/finance/payments";
  }

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder="Search reference, invoice or expense…"
        filters={[
          {
            param: "direction",
            label: "Direction",
            options: [
              { value: "RECEIPT", label: "Received" },
              { value: "DISBURSEMENT", label: "Paid out" },
            ],
          },
          {
            param: "status",
            label: "Status",
            options: [
              { value: "RECORDED", label: "Recorded" },
              { value: "VOIDED", label: "Voided" },
            ],
          },
          {
            param: "method",
            label: "Method",
            options: [
              { value: "BANK_TRANSFER", label: "Bank transfer" },
              { value: "CARD", label: "Card" },
              { value: "CASH", label: "Cash" },
              { value: "CHECK", label: "Cheque" },
              { value: "OTHER", label: "Other" },
            ],
          },
        ]}
        sortOptions={[
          { value: "date-desc", label: "Newest first" },
          { value: "date-asc", label: "Oldest first" },
          { value: "amount-desc", label: "Largest first" },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<Banknote />}
            title="No payments match these filters."
            description="Adjust or clear the filters to see more."
            action={{ label: "Clear filters", href: "/finance/payments" }}
          />
        ) : (
          <EmptyState
            icon={<Banknote />}
            title="No payments recorded."
            description="Payments are recorded against a sent invoice or an approved expense."
          />
        )
      ) : (
        <>
          <PaymentTable payments={result.data} />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
