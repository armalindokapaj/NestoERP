import type { CredentialVerificationStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * Where a qualification stands with its verifier (E-02 §29-§31, §72-§79, §91).
 *
 * The same states as an employee document, for the same reasons. The service
 * holds what the table cannot: the person never verifies their own (§74), and
 * a qualification is the person's across the group, so the write is guarded by
 * the group and the version the verifier read rather than by one company.
 */
export type QualificationVerificationAction = "verify" | "reject" | "resubmit" | "expire" | "supersede";

export const qualificationVerificationMachine = defineStateMachine<CredentialVerificationStatus, QualificationVerificationAction>({
  key: "person_qualification_verification",
  model: "personQualification",
  field: "verificationStatus",
  states: ["UNVERIFIED", "VERIFIED", "REJECTED", "EXPIRED", "SUPERSEDED"],
  terminal: ["SUPERSEDED"],
  transitions: [
    { action: "verify", from: ["UNVERIFIED"], to: "VERIFIED", permission: "hr.qualification.verify", freezes: "what was checked: a later file is shown as not checked" },
    { action: "reject", from: ["UNVERIFIED"], to: "REJECTED", permission: "hr.qualification.verify", requiresReason: true },
    { action: "resubmit", from: ["REJECTED"], to: "UNVERIFIED", permission: ["people.qualification.add_self", "hr.qualification.manage"] },
    { action: "expire", from: ["VERIFIED"], to: "EXPIRED", permission: "hr.qualification.verify" },
    { action: "supersede", from: ["UNVERIFIED", "VERIFIED", "EXPIRED", "REJECTED"], to: "SUPERSEDED", permission: ["people.qualification.add_self", "hr.qualification.manage"] },
  ],
});
