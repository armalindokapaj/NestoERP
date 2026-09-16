import type { PaymentStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * A payment's one move (PRD #15 §85; PRD #49 §132).
 *
 * A payment is recorded, and it may be voided — never deleted and never
 * edited. Voiding leaves the row and its reason behind and stops it counting
 * toward settlement, which is the difference between a correction and a
 * cover-up. Nothing brings a voided payment back: money received again is a
 * new payment.
 */
export type PaymentTransitionAction = "void";

export const paymentMachine = defineStateMachine<PaymentStatus, PaymentTransitionAction>({
  key: "payment",
  model: "payment",
  field: "status",
  states: ["RECORDED", "VOIDED"],
  terminal: ["VOIDED"],
  transitions: [
    { action: "void", from: ["RECORDED"], to: "VOIDED", permission: "finance.payment.void", requiresReason: true, freezes: "the whole payment" },
  ],
});
