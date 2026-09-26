-- AUD-01 §3, §4: what each invoice and expense has been paid, derived when read.
--
-- Two views, nothing stored: a row's paid amount is the sum of its live
-- allocations (not reversed, of a payment still RECORDED), taken in one lateral
-- aggregate keyed on the allocation's own target column. An allocation that also
-- names an installment is still one row here, so nothing is counted twice, and
-- the register's filters, counts and totals read the same figure the detail
-- page does. The lateral aggregate runs per invoice row that survives the outer
-- filters, so a query narrowed to its companies aggregates only their records.
--
-- `integrityIssues` counts live allocations whose allocation or payment belongs
-- to another company, or whose payment is in another currency. The allocation
-- writer refuses both; a non-zero value means the data was changed around it,
-- and the register fails that response rather than show an inflated total.
--
-- Additive (LOW risk). Rollback: DROP VIEW "expense_settlements"; DROP VIEW "invoice_settlements";

CREATE VIEW "invoice_settlements" AS
SELECT
  i."id" AS "invoiceId",
  i."companyId",
  i."currency",
  i."status",
  i."dueDate",
  i."totalAmount",
  COALESCE(s."paid", 0) AS "paidAmount",
  GREATEST(i."totalAmount" - COALESCE(s."paid", 0), 0) AS "outstandingAmount",
  COALESCE(s."inconsistent", 0)::integer AS "integrityIssues"
FROM "invoices" i
LEFT JOIN LATERAL (
  SELECT
    SUM(a."amount") AS "paid",
    COUNT(*) FILTER (
      WHERE a."companyId" <> i."companyId" OR p."companyId" <> i."companyId" OR p."currency" <> i."currency"
    ) AS "inconsistent"
  FROM "payment_allocations" a
  JOIN "payments" p ON p."id" = a."paymentId"
  WHERE a."invoiceId" = i."id" AND a."reversedAt" IS NULL AND p."status" = 'RECORDED'
) s ON TRUE;

CREATE VIEW "expense_settlements" AS
SELECT
  e."id" AS "expenseId",
  e."companyId",
  e."currency",
  e."status",
  e."totalAmount",
  COALESCE(s."paid", 0) AS "paidAmount",
  GREATEST(e."totalAmount" - COALESCE(s."paid", 0), 0) AS "outstandingAmount",
  COALESCE(s."inconsistent", 0)::integer AS "integrityIssues"
FROM "expenses" e
LEFT JOIN LATERAL (
  SELECT
    SUM(a."amount") AS "paid",
    COUNT(*) FILTER (
      WHERE a."companyId" <> e."companyId" OR p."companyId" <> e."companyId" OR p."currency" <> e."currency"
    ) AS "inconsistent"
  FROM "payment_allocations" a
  JOIN "payments" p ON p."id" = a."paymentId"
  WHERE a."expenseId" = e."id" AND a."reversedAt" IS NULL AND p."status" = 'RECORDED'
) s ON TRUE;
