import { ReceiptText } from "lucide-react";
import { ZodError } from "zod";

import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { combinedOption, InvalidRegisterFilters, registerHref } from "@/components/finance/register-filters";
import { NoAccessibleData } from "@/components/finance/group-rows";
import { InvoiceTable } from "@/components/finance/invoice-table";
import { RegisterExportButton } from "@/components/finance/register-export-button";
import { CanonicalUrl, RegisterResults } from "@/components/finance/register-results";
import { RegisterSummary } from "@/components/finance/register-summary";
import { EmptyState } from "@/components/ui/empty-state";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { canonicalInvoiceSearch, parseInvoiceQuery, searchString } from "@/lib/modules/finance/finance.query";
import { companyFilterOptions, financeContexts, financeExportEligibility } from "@/lib/modules/finance/finance.workspace";
import { invoiceCurrenciesAcross, invoiceFilterOptions } from "@/lib/modules/finance/invoices/invoice.repository";
import * as invoices from "@/lib/modules/finance/invoices/invoice.service";
import type { InvoiceListQuery } from "@/lib/modules/finance/invoices/invoice.schema";
import { getTranslations } from "@/lib/i18n/server";
import { firstValue } from "@/lib/modules/shared/list-query";
import { INVOICE_SORT_KEYS } from "@/lib/modules/finance/invoices/invoice.schema";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The invoice list (PRD #15 §160–§164; AUD-01).
 *
 * Filter options come from the invoices this reader can already see, so a
 * dropdown can never name a client or project they have no access to
 * (PRD #15 §175).
 *
 * In the Group workspace it is the invoices of every company the reader may
 * open Finance in, with a Company filter over those companies (§36, §86). A
 * client or a project belongs to one company, so those filters are a company
 * workspace's; search reaches both.
 *
 * Every filter — settlement included — is applied by the database before the
 * count, the filtered totals and the page, so the totals, "N matching" and the
 * pages all describe the same set (AUD-01 §4-§6).
 */
export async function InvoicesList({
  context,
  searchParams,
  archived = false,
  basePath,
}: {
  context: UserContext;
  searchParams: SearchParams;
  archived?: boolean;
  basePath: string;
}) {
  const t = await getTranslations("finance");
  const group = inGroupWorkspace(context);
  const company = group ? firstValue(searchParams.company) : undefined;
  const readable = group ? await financeContexts(context, "finance.invoice.view") : [];
  if (group && readable.length === 0) return <NoAccessibleData />;

  // A date that is not a date, or a range that ends before it starts, is said
  // so rather than ignored (AUD-01 §5.1).
  let query: InvoiceListQuery;
  try {
    query = parseInvoiceQuery(searchParams, archived ? { archived: true } : {});
  } catch (error) {
    if (error instanceof ZodError) return <InvalidRegisterFilters href={registerHref(basePath, archived)} />;
    throw error;
  }

  const [result, options, eligibility] = await Promise.all([
    invoices.listInvoicesForWorkspace(context, query, { company }),
    group
      ? invoiceCurrenciesAcross(readable).then((currencies) => ({ clients: [], projects: [], currencies }))
      : invoiceFilterOptions(context),
    financeExportEligibility(context, "finance.invoice.view", company),
  ]);

  const hasFilters = Boolean(
    query.search ||
      (!archived && query.status?.length) ||
      query.settlement?.length ||
      query.clientId ||
      query.projectId ||
      query.currency ||
      query.issuedFrom ||
      query.issuedTo ||
      company,
  );

  const statusOptions = (["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "REJECTED", "CANCELLED"] as const).map((value) => ({
    value,
    label: t(`recordStatus.${value}`),
  }));
  const settlementOptions = (["UNPAID", "PARTIALLY_PAID", "PAID", "OVERDUE"] as const).map((value) => ({
    value,
    label: t(`settlement.${value}`),
  }));

  const filters: FilterConfig[] = [
    ...(group ? [{ param: "company", label: t("group.company"), options: companyFilterOptions(readable) }] : []),
    ...(archived ? [] : [{ param: "status", label: t("columns.status"), options: combinedOption(statusOptions, query.status) }]),
    { param: "settlement", label: t("columns.settlement"), options: combinedOption(settlementOptions, query.settlement) },
    ...(group
      ? []
      : [
          {
            param: "clientId",
            label: t("invoiceForm.client"),
            options: options.clients.map((client) => ({ value: client.id, label: client.name })),
          },
          {
            param: "projectId",
            label: t("form.project"),
            options: options.projects.map((project) => ({ value: project.id, label: project.name })),
          },
        ]),
    ...(options.currencies.length > 1
      ? [
          {
            param: "currency",
            label: t("form.currency"),
            options: options.currencies.map((code) => ({ value: code, label: code })),
          },
        ]
      : []),
  ];

  // The list that ran, as an address: the page it landed on, the filters as understood (AUD-01 §5.2).
  const canonical = canonicalInvoiceSearch(searchParams, query, result.pagination.page);
  const canonicalParams = new URLSearchParams(canonical);
  function buildHref(page: number) {
    const params = new URLSearchParams(canonicalParams);
    if (page > 1) params.set("page", String(page));
    else params.delete("page");
    const search = params.toString();
    return search ? `${basePath}?${search}` : basePath;
  }

  const empty = result.data.length === 0;

  return (
    <div className="space-y-4">
      {canonical !== searchString(searchParams) ? <CanonicalUrl href={canonical ? `${basePath}?${canonical}` : basePath} /> : null}
      <ListToolbar
        searchPlaceholder={t("invoices.search")}
        filters={filters}
        sortOptions={[
          { value: "issue-desc", label: t("sort.newest") },
          { value: "issue-asc", label: t("sort.oldest") },
          { value: "due-asc", label: t("sort.dueSoonest") },
          { value: "amount-desc", label: t("sort.largest") },
          { value: "amount-asc", label: t("sort.smallest") },
          { value: "number-asc", label: t("sort.invoiceNumber") },
        ]}
      />

      <RegisterResults>
        {!empty || hasFilters ? (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <RegisterSummary summary={result.summary} register="invoices" />
            <RegisterExportButton endpoint="/api/finance/invoices/export" matchingCount={result.summary.matchingCount} eligibility={eligibility} />
          </div>
        ) : null}

        {empty ? (
          hasFilters ? (
            <EmptyState
              icon={<ReceiptText />}
              title={t("invoices.noMatch")}
              description={t("list.noMatchBody")}
              action={{ label: t("list.clearFilters"), href: registerHref(basePath, archived) }}
            />
          ) : (
            <EmptyState
              icon={<ReceiptText />}
              title={archived ? t("invoices.noArchived") : t("invoices.none")}
              description={
                archived
                  ? t("invoices.noArchivedBody")
                  : t("invoices.noneBody")
              }
              action={
                !archived && !group && can(context, "finance.invoice.create")
                  ? { label: t("overview.newInvoice"), href: "/finance/invoices/new" }
                  : undefined
              }
            />
          )
        ) : (
          <>
            <InvoiceTable invoices={result.data} sort={{ value: query.sort, keys: INVOICE_SORT_KEYS }} />
            <Pagination meta={result.pagination} buildHref={buildHref} />
          </>
        )}
      </RegisterResults>
    </div>
  );
}
