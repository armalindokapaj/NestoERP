import type { SupplierQuoteStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The supplier quote lifecycle (PRD #19 §78-§94, §247; PRD #49 §132).
 *
 * `DRAFT` is in the enum and nothing writes it: a quote is recorded when the
 * supplier's answer arrives, and is `RECEIVED` from its first write. It stays
 * a state so a row stored as a draft can still be disqualified, and no
 * transition leads into it.
 *
 * Passing over a quote is never an action of its own. Selecting one quote
 * passes over every other answer on the enquiry still `RECEIVED`, in the same
 * transaction and under the same permission, so a comparison can never show
 * two winners (§94, §211). That an enquiry has at most one winner is checked
 * by the service above the write (`QUOTE_ALREADY_SELECTED`).
 */
export type SupplierQuoteAction = "disqualify" | "select" | "pass_over";

export const supplierQuoteMachine = defineStateMachine<SupplierQuoteStatus, SupplierQuoteAction>({
  key: "supplier_quote",
  model: "supplierQuote",
  field: "status",
  states: ["DRAFT", "RECEIVED", "DISQUALIFIED", "SELECTED", "NOT_SELECTED"],
  terminal: ["DISQUALIFIED", "SELECTED", "NOT_SELECTED"],
  transitions: [
    { action: "disqualify", from: ["DRAFT", "RECEIVED"], to: "DISQUALIFIED", permission: "procurement.quote.disqualify", freezes: "the quote as answered" },
    { action: "select", from: ["RECEIVED"], to: "SELECTED", permission: "procurement.quote.select", freezes: "the quote as answered" },
    { action: "pass_over", from: ["RECEIVED"], to: "NOT_SELECTED", permission: "procurement.quote.select", freezes: "the quote as answered" },
  ],
});
