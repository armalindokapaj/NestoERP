# ADR 0016: Finance registers filter settlement in the database

**Status:** accepted, 26 September 2026
**Context:** AUD-01 Finance Accuracy ("AUD-01" below; §-numbers are its own),
after PRD #15 (Finance) and Workspace Context ([ADR 0011](0011-workspace-context.md)).

## Context

The invoice and expense lists read a page, then asked for that page's paid
amounts, then dropped the rows whose settlement did not match. A Paid search
showed only the paid invoices that happened to fall on the page, the count was
the unfiltered count, and a page could come back empty while the next one held
matches. Both workspaces did it, in both registers. There was no CSV export for
either, although `finance.export` existed.

Settlement is derived, never stored (PRD #15 §42, §45): paid is the sum of the
live allocations naming the record, and the classification depends on the
workflow status, the due date and the moment of reading. Prisma's `where`
cannot compare an aggregate with a column, which is why it was filtered in
JavaScript.

## Decisions

1. **Two read-only SQL views: `invoice_settlements` and `expense_settlements`.**
   Migration `20260926120000_finance_settlement_views_aud_01` is additive, and
   `DROP VIEW` reverses it. Each view gives one row per record: its company,
   currency, workflow status, due date (invoices only), total, `paidAmount`,
   `outstandingAmount` and `integrityIssues`.
   - Paid comes from a `LEFT JOIN LATERAL` that sums the live allocations keyed
     on the allocation's own target column (not reversed, payment `RECORDED`).
     An allocation that also names an installment is still one row, so it is
     never counted twice (§3).
   - Outstanding is `GREATEST(total − paid, 0)`.
   - Nothing is persisted and nothing is backfilled.

   Prisma reads the views through the `views` preview feature, as 1:1 relations
   (`Invoice.settlement`, `Expense.settlement`). Two things follow:
   - The eligibility clause stays the repositories' existing
     `buildInvoiceListWhere` / `buildExpenseListWhere`, built from the scope
     helpers (§4 step 2). The project-membership rules are not written a second
     time in SQL.
   - Prisma migrate ignores views: `prisma migrate diff` reports no drift with
     them in the schema.

   *Rejected:*
   - Hand-written SQL for the whole list: a second copy of the scope rules.
   - Loading the eligible ids into memory: forbidden by §4.
   - A trigger-maintained paid column: persisted settlement, which the PRD
     prefers to avoid.

2. **One register read per record type**, `readInvoiceRegister` /
   `readExpenseRegister`. It serves the page, the count, the filtered totals and
   the export. The Company workspace is `[session]`; the Group workspace is each
   readable company's own list clause OR-ed together, as before. Inside one
   snapshot it runs:
   1. A `groupBy` currency over the view, filtered by `companyId in (…)`, the
      settlement arms and `invoice: { is: eligible }`. This gives the totals,
      and its counts summed are the total.
   2. The effective page: `min(page, totalPages)`. A page past the end reads the
      last real page (§5.2).
   3. The rows: the same clause, with the settlement arms as
      `settlement: { is: … }`, ordered by the chosen sort and then `id`
      (§5.2), selecting the view's `paidAmount`.

   Adding the company to the view-side clause lets Postgres run the lateral
   aggregate only for those companies' records.

3. **One snapshot, one instant.** `readRegisterSnapshot` uses the existing
   `runInTransaction` with `RepeatableRead` and `SET TRANSACTION READ ONLY`.
   `evaluatedAt` is taken once per response, and services accept `now` so tests
   freeze it. Every row and the settlement filter classify at that instant (§3,
   §4). A timeout is an error, never a shorter answer.

4. **The classifier lives in two forms, side by side.** `invoiceSettlement` /
   `expenseSettlement` (JavaScript, for rows and detail pages) and
   `invoiceSettlementWhere` / `expenseSettlementWhere` (the arms over the view's
   columns) are in `invoice.status.ts`. The integration suite checks, over
   status × paid × due-date matrices, that each settlement value selects the same
   records both ways. It also checks that the views' paid figures equal
   `paidByInvoice` / `paidByExpense` for every record in the database.

5. **Integrity fails the response.** An allocation from another company, or a
   payment in another currency, makes `integrityIssues` non-zero. A register
   that would include such a record, or that record's detail page, throws
   `INTERNAL_ERROR` with `details.code = "SETTLEMENT_INTEGRITY"` and logs
   `finance.settlement_integrity` with a count only, instead of showing an
   inflated total (§3). The release invariants check the views for any.

6. **Export is the same read without the page.**
   - The routes are `GET /api/finance/{invoices,expenses}/export`.
   - Each needs the list's permission plus `finance.export` in every company it
     answers for. A mixed Group view is refused whole
     (`EXPORT_COMPANY_REQUIRED`) (§7).
   - The cap is 10 000 rows. Beyond it the route answers 422 `VALIDATION_ERROR`
     with `details.code = "EXPORT_LIMIT_EXCEEDED"`: business sub-codes live in
     `details.code` throughout the API.
   - The file is UTF-8 with a BOM and CRLF line endings. `csvCell` now also
     guards a formula hidden behind leading whitespace or control characters.

7. **The page shows what ran.** The server renders the effective page and
   normalised filters. `CanonicalUrl` then replaces the address in place, with no
   second request, so the controls, Refresh and Back agree with the screen.

## Consequences

- Every list is two data queries plus Prisma's relation loads (client, project,
  settlement). The count does not change with the page size, and nothing is
  read per row.
- Every page shows "Filtered results": the count and the Total, Paid and
  Outstanding per currency. The JSON list adds `summary` beside `data` and
  `pagination`.
- The views are the one query-time definition of "paid". A future change to
  what counts as a live allocation changes the migration, `LIVE_ALLOCATION`,
  and the parity test with them.
- Rolling back the code without the migration is harmless: the views are only
  read. Rolling back the migration requires the code first.
