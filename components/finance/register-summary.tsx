import { Money } from "@/components/finance/money";
import { getTranslations } from "@/lib/i18n/server";
import type { FinanceListSummary } from "@/lib/modules/finance/finance.types";

/**
 * What a register's filters matched, all of it (AUD-01 §6).
 *
 * The count and, per currency, the total, paid and outstanding of every match —
 * not of the page below. Currencies sit side by side and wrap on a narrow
 * screen; nothing is converted or added across them. It describes the filters,
 * so it is labelled as the filtered result and never as a debt figure: a filter
 * may well include drafts or cancelled records.
 */
export async function RegisterSummary({ summary, register }: { summary: FinanceListSummary; register: "invoices" | "expenses" }) {
  const t = await getTranslations("financeRegister");
  const count = summary.matchingCount;

  return (
    <section aria-label={t("summaryLabel")} data-testid="register-summary" data-evaluated-at={summary.evaluatedAt} className="min-w-0 space-y-2">
      <div>
        <p className="text-meta font-medium text-fg-subtle">{t("filteredResults")}</p>
        <p className="text-card font-semibold text-fg" data-testid="register-matching" data-count={count}>
          {register === "invoices" ? t("matchingInvoices", { count }) : t("matchingExpenses", { count })}
        </p>
      </div>
      {summary.byCurrency.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {summary.byCurrency.map((group) => (
            <li
              key={group.currency}
              data-testid="register-currency"
              data-currency={group.currency}
              className="min-w-0 max-w-full rounded-md border border-line bg-surface px-3 py-2"
            >
              <p className="text-meta font-semibold text-fg-muted">
                {group.currency} <span className="font-normal tabular-nums">· {group.count}</span>
              </p>
              <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-table">
                <div className="min-w-0">
                  <dt className="text-meta text-fg-subtle">{t("total")}</dt>
                  <dd data-field="total">
                    <Money amount={group.totalAmount} currency={group.currency} emphasis />
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-meta text-fg-subtle">{t("paid")}</dt>
                  <dd data-field="paid">
                    <Money amount={group.paidAmount} currency={group.currency} />
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-meta text-fg-subtle">{t("outstanding")}</dt>
                  <dd data-field="outstanding">
                    <Money amount={group.outstandingAmount} currency={group.currency} />
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
