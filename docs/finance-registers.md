# Finance registers: settlement, filtered totals and CSV export (AUD-01)

Built from **AUD-01 Finance Accuracy**
(`NESTO_V0.1_PRD_AUD-01_Finance_Accuracy`, cited as "AUD-01 §n"). The
decisions are in [ADR 0016](adr/0016-finance-register-settlement.md).

The invoice and expense registers — `/finance/invoices`, `/finance/expenses`
and their JSON routes — return every record the reader may see that matches
the filters. The count, the per-currency totals, the pages and the CSV export
all describe the same set, read from one database snapshot. This holds in a
company workspace and in the Group workspace.

```
session → workspace → readable companies (financeContexts)
        → each company's list clause (scope, archive, search, filters)       ─┐
        → settlement arms over the settlement view                           ├─ one snapshot
        → totals per currency (their counts are the total)                   │  (RR, read only,
        → sort + id → the page (or every match, for the export)             ─┘   one evaluatedAt)
```

## Where things live

| Concern | Location |
| --- | --- |
| Paid and outstanding per record, derived when read | views `invoice_settlements`, `expense_settlements` (migration `20260926120000_finance_settlement_views_aud_01`); Prisma `InvoiceSettlement`, `ExpenseSettlement` |
| Settlement classifier, both forms | `lib/modules/finance/invoices/invoice.status.ts`: `invoiceSettlement` / `expenseSettlement` for rows; `invoiceSettlementWhere` / `expenseSettlementWhere` for the database |
| The register read (summary, effective page, rows) | `readInvoiceRegister` in `invoices/invoice.repository.ts`; `readExpenseRegister` in `expenses/expense.repository.ts` |
| Snapshot, page window, summary, integrity, export limits, metric | `lib/modules/finance/finance.register.ts` |
| Company and Group lists, exports, the injected clock | `listInvoices` / `listInvoicesForWorkspace` / `exportInvoicesForWorkspace` and their expense twins in the services |
| Who may export from where | `financeExportContexts`, `financeExportEligibility` in `finance.workspace.ts` |
| Query parsing, normalisation, canonical address | `finance.query.ts`: `parseInvoiceQuery`, `canonicalInvoiceSearch`, and the expense twins |
| CSV columns and file | `finance.export.ts`; cells through `lib/utils/csv.ts` (`csvCell`) |
| Routes | `app/api/finance/{invoices,expenses}/route.ts` (list), `…/export/route.ts` (CSV) |
| Pages | `app/(nesto)/finance/{invoices,expenses}/*-list.tsx`; `components/finance/register-{summary,export-button,results,filters}.tsx` |
| Copy (English, Albanian) | `financeRegister` in `lib/i18n/messages/{en,sq}.ts` |

## Settlement (AUD-01 §3)

- `paidAmount` is the sum of the allocations that name the record, are not
  reversed, and belong to a `RECORDED` payment. It is aggregated once per
  allocation, keyed on the allocation's own target column. An allocation that
  also names an installment therefore counts once.
- `outstandingAmount` is `max(total − paid, 0)`.
- Unallocated money, voided payments and reversed allocations count for
  nothing.

Rules are applied in order, at the response's single `evaluatedAt`:

| Record | Condition | Settlement |
| --- | --- | --- |
| Invoice | outstanding ≤ 0 | PAID |
| Invoice | status SENT and dueDate < evaluatedAt | OVERDUE |
| Invoice | paid > 0 | PARTIALLY_PAID |
| Invoice | otherwise | UNPAID |
| Expense | outstanding ≤ 0 / paid > 0 / otherwise | PAID / PARTIALLY_PAID / UNPAID |

Due exactly at `evaluatedAt` is not overdue. A draft or an archived invoice is
never overdue. An overpaid record keeps what it was paid, with outstanding 0.
The workflow status is never changed by settlement.

**Integrity.** A live allocation from another company, or a payment in another
currency, makes the record's `integrityIssues` non-zero. When that happens:
- the list, export or detail read holding the record fails with
  `INTERNAL_ERROR` and `details.code = "SETTLEMENT_INTEGRITY"`;
- the log `finance.settlement_integrity` records a count only;
- the release invariant in `tests/integration/release/data-invariants.test.ts`
  fails.

## Filters, order and pages (AUD-01 §5)

- **Parameters** are unchanged. Invoices: `search`, `status`, `settlement`,
  `clientId`, `projectId`, `currency`, `issuedFrom`, `issuedTo`, `archived`,
  `page`, `limit`, `sort`. Expenses swap `clientId` for `category` and the date
  pair for `incurredFrom` / `incurredTo`. The Group workspace adds `company`.
- **Matching.** Values within one filter are OR'ed, and filters are AND'ed with
  each other. A repeated value counts once. An unknown enum value or sort is
  dropped, as before. A date that is not a date, or a range that ends before it
  starts, is a validation error: 422 on the API, and a "These filters could not
  be applied." state on the page.
- **Company filter.** A value the reader may not read narrows the list to
  nothing. It never widens it to all companies.
- **Archive.** `archived=1` is its own dataset, and the workflow `status`
  filter does not apply to it.
- **Order.** Every sort ends in the record `id`.
- **Pages.** `limit` defaults to 25 and is capped at 100.
  - A page past the end reads the last real page.
  - No match is page 1 of nothing.
  - `pagination.page` is the page actually read.
- **Canonical address.** The page replaces its address with the list that ran:
  the effective page, and the filters as understood. It uses
  `history.replaceState`, so there is no second request and Back is unchanged.

## Summary (AUD-01 §6)

The JSON list returns `{ data, pagination, summary }`:

```ts
summary: {
  evaluatedAt: string;          // the response's one instant
  matchingCount: number;        // = pagination.total = Σ byCurrency.count
  byCurrency: Array<{ currency; count; totalAmount; paidAmount; outstandingAmount }>; // sorted by code
}
```

Outstanding is the sum of each record's own outstanding. There is no
conversion and no cross-currency total. On the page, the summary is headed
**Filtered results**, shows "N matching invoices/expenses", and gives one card
per currency.

## Export (AUD-01 §7, §8)

`GET /api/finance/invoices/export` and `GET /api/finance/expenses/export` take
the list's query string. `page` and `limit` are ignored.

**Permissions.**
- The export needs the list's permission (`finance.invoice.view` or
  `finance.expense.view`) plus `finance.export`, with Finance enabled.
- In the Group workspace the reader must hold both in every company the list
  answers for. Otherwise the whole request is refused: 403 `FORBIDDEN` with
  `details.code = "EXPORT_COMPANY_REQUIRED"`.
- The page mirrors this. It offers the export only once the Company filter
  names export-enabled companies, and lists them.

**Limit.** More than 10 000 matches is refused with 422 `VALIDATION_ERROR`,
`details.code = "EXPORT_LIMIT_EXCEEDED"` and the message "Too many records to
export. Narrow your filters to 10,000 records or fewer." No partial file is
written.

**The file.**
- UTF-8 with a BOM, CRLF line endings, and a CRLF after the last row.
- Headers:
  - `Content-Type: text/csv; charset=utf-8`
  - `Content-Disposition: attachment; filename="nesto-invoices-YYYYMMDD-HHMMSSZ.csv"`
  - `Cache-Control: private, no-store`
  - `X-Export-Row-Count`
  - `X-Export-Evaluated-At`
- With no match, the file is the header row alone. The page does not offer the
  export and says why.

**Columns.**
- Invoices: Company ID, Company, Invoice ID, Invoice number, Client, Project
  code, Project, Issue date, Due date, Currency, Workflow status, Settlement,
  Total, Paid, Outstanding.
- Expenses: the same, with Expense ID, Expense number, Payee, Expense date and
  Category.

**Cell safety.** A text cell whose first non-space, non-control character is
`= + - @`, or that starts with a control character, is written as text with a
leading apostrophe. Plain numbers keep their sign.

**Records of the export.** The audit log gets `REPORT_EXPORTED_CSV`. The log
gets `finance.register_export` with the row count and duration. The histogram
`finance_register_query_ms{register,operation,scope,outcome}` times every list
and export.

## Refresh after a correction (AUD-01 §9)

The lists are dynamic, and no finance payload is cached between users or
requests. Every correction path invalidates what the reader sees:
- Recording and voiding a payment are server actions. They call
  `revalidatePath("/finance", "layout")`, which also purges the client router
  cache.
- Invoice and expense lifecycle actions do the same.
- Allocation reversal and replacement on a unit call `router.refresh()`.

So the next navigation, Refresh or Back reads the canonical query again. A row
that no longer matches drops out of the count, and a page left past the end
comes back as the last real page.

## Rollback

- **Code only.** Safe: the views are only read. Rolling back reopens the
  accuracy defect: the old lists filtered settlement on the page.
- **Migration.** Run `DROP VIEW "expense_settlements"; DROP VIEW "invoice_settlements";`
  after the code that reads them is gone. Nothing is backfilled and no data
  changes.

## Tests and commands

Every command runs against a real PostgreSQL database. Point `DATABASE_URL` at
a lane — a copy of the development database with the migration — and never at
the one a dev server is using.

| What | Command | Fixtures |
| --- | --- | --- |
| Settlement, filters, pages, totals, scope, parity, snapshot (FA-01..FA-13, FA-18, FA-19) | `npx vitest run tests/api/finance/finance-accuracy.test.ts` | `aud01_…` invoices, expenses, payments, allocations; removed after each test |
| Export and JSON routes (FA-13..FA-17, FA-21) | `npx vitest run tests/api/finance/finance-export.test.ts` (`AUD01_SAMPLE_DIR=<dir>` keeps two sample files) | `aud01x_…`, including 10 001 expenses for the cap |
| Pure parts | `npx vitest run tests/unit/finance/finance-register.test.ts tests/unit/utils/csv.test.ts` | none |
| Browser (FA-01, FA-06, FA-11, FA-15, FA-16, FA-19..FA-21) | `NEXT_DIST_DIR=.next-e2e next build` → `next start -p 3170` → `E2E_BASE_URL=http://localhost:3170 npx playwright test tests/e2e/modules/finance-accuracy.spec.ts` (`AUD01_SHOTS=<dir>` saves the four widths) | `AUD01E-…` invoices and expenses, removed by `removeTestFinanceRecords` |
| Volume, plans, query count (FA-22) | `NESTO_PERF=1 AUD01_PERF_OUT=<dir> npx vitest run tests/perf/finance-registers.perf.test.ts` | 10 000 + 10 000 `aud01p_…` records across five companies; removed afterwards |
| Release invariant | `npx vitest run tests/integration/release/data-invariants.test.ts` | the data as it stands |

The measured results are in [release-readiness §40](release-readiness.md).
