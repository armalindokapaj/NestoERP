import type { LeaveBalanceDTO } from "@/lib/modules/hr/hr.types";
import { getTranslations } from "@/lib/i18n/server";
import { hrLabel } from "./hr-labels";
import { formatDays } from "./hr-format";

/**
 * Leave entitlement and what is left of it (PRD #16 §79, §174).
 *
 * Only the types V0.1 caps carry a balance. Sick, parental and unpaid leave are
 * counted but never refused for running out, so they are shown as days taken
 * rather than as a remaining figure (PRD #16 §85).
 */
export async function LeaveBalanceCard({
  balances,
  year,
  title,
}: {
  balances: LeaveBalanceDTO[];
  year: number;
  title?: string;
}) {
  const t = await getTranslations("hr");
  return (
    <section className="nesto-card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-card font-semibold text-fg">{title ?? t("balance.title")}</h2>
        <span className="text-meta text-fg-subtle">{year}</span>
      </div>

      {balances.length === 0 ? (
        <p className="mt-4 text-table text-fg-subtle">{t("balance.none")}</p>
      ) : (
        <dl className="mt-4 divide-y divide-line">
          {balances.map((balance) => (
            <div
              key={balance.leaveType}
              className="flex items-baseline justify-between gap-3 py-2.5 first:pt-0"
            >
              <dt className="min-w-0 text-table text-fg-muted">
                {hrLabel(t, "leaveType", balance.leaveType)}
              </dt>
              <dd className="shrink-0 text-right">
                {balance.tracked ? (
                  <>
                    <span className="text-table font-semibold tabular-nums text-fg">
                      {formatDays(balance.availableDays)}
                    </span>
                    <span className="text-meta text-fg-subtle">
                      {" "}
                      {t("balance.ofDaysLeft", { days: formatDays(balance.entitledDays) })}
                    </span>
                  </>
                ) : (
                  <span className="text-table tabular-nums text-fg-muted">
                    {t("balance.daysTaken", { days: formatDays(balance.usedDays) })}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
