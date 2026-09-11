import {
  calculateLine,
  type CalculatedLine,
  type LineInput,
} from "@/lib/modules/finance/invoices/invoice.calculation";
import { add, roundMoney, type Money } from "@/lib/modules/finance/finance.money";

/**
 * Proposal arithmetic (PRD #17 §111, §209, §224).
 *
 * The same rules as an invoice, and deliberately the *same code*: a proposal
 * for €395,000 that becomes an invoice for €395,000.01 because two modules
 * round differently is the kind of discrepancy a client writes in about
 * (PRD #17 §111).
 *
 * Nothing here reads a total from its input. Every figure is derived from
 * quantity, unit price and tax rate, so a crafted request cannot quote one
 * amount while displaying another (PRD #17 §224).
 */

export type ProposalLineInput = LineInput;
export type CalculatedProposalLine = CalculatedLine;

export type CalculatedProposal = {
  lines: CalculatedProposalLine[];
  subtotal: Money;
  taxAmount: Money;
  totalAmount: Money;
};

export function calculateProposal(lines: ProposalLineInput[]): CalculatedProposal {
  const calculated = lines.map((line, index) => calculateLine(line, index));

  return {
    lines: calculated,
    subtotal: roundMoney(add(...calculated.map((line) => line.subtotal))),
    taxAmount: roundMoney(add(...calculated.map((line) => line.taxAmount))),
    totalAmount: roundMoney(add(...calculated.map((line) => line.totalAmount))),
  };
}

export { calculateLine as calculateProposalLine };
