import { Prisma } from "@prisma/client";

/**
 * What every QA/QC register read shares (AUD-08 §3, §4).
 *
 * **One snapshot.** A page of rows and the count beside it are read in one
 * REPEATABLE READ transaction, so a defect raised between the two statements
 * cannot make "1–25 of 73" disagree with the rows under it (DT-06). Across
 * requests the list is a live view: a row inserted between page 1 and page 2
 * can shift the offset window, and nothing here promises otherwise (§4).
 *
 * **One order.** Every sort ends in the record id (`withTieBreaker`), so two
 * defects of the same severity, or two NCRs raised in the same second, keep
 * one order on every page, in the API and in the export (DT-04). Null placement is written on each nullable sort key where it is
 * declared.
 */
export const SNAPSHOT = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead };

/**
 * A bounded preview of a register on a record page — a project's QA/QC tab —
 * with the true number of matching records beside it, so the tab can say
 * "20 of 57" and link to the full list instead of silently stopping at 20
 * (AUD-08 §4, DT-01).
 */
export type ListPreview<T> = { data: T[]; total: number };
