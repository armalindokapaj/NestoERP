import type { CredentialVerificationStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * Where an employee document stands with its verifier (E-02 §29-§31, §72-§79, §91).
 *
 * Semantic actions only — nobody sets the status by editing it (§31). Two rules
 * the table cannot express, both held by the service: nobody verifies or
 * rejects their own document (§74), and only a category that is evidence is
 * checked at all — a contract HR filed is HR's own record (`verifiable`).
 *
 * `expire` is the daily worker's, reaching a verified document on the day
 * after its expiry date (§90). `supersede` is what a renewal or a replacement
 * does to the document it replaces (§66, §91); the document and its history
 * stay. A rejected document goes back to the verifier by resubmitting it,
 * usually with a new file (§79).
 */
export type EmployeeDocumentVerificationAction = "verify" | "reject" | "resubmit" | "expire" | "supersede";

export const employeeDocumentVerificationMachine = defineStateMachine<CredentialVerificationStatus, EmployeeDocumentVerificationAction>({
  key: "employee_document_verification",
  model: "employeeDocumentLink",
  field: "verificationStatus",
  states: ["UNVERIFIED", "VERIFIED", "REJECTED", "EXPIRED", "SUPERSEDED"],
  terminal: ["SUPERSEDED"],
  transitions: [
    { action: "verify", from: ["UNVERIFIED"], to: "VERIFIED", permission: "hr.document.verify", freezes: "what was checked: a later file is shown as not checked" },
    { action: "reject", from: ["UNVERIFIED"], to: "REJECTED", permission: "hr.document.verify", requiresReason: true },
    { action: "resubmit", from: ["REJECTED"], to: "UNVERIFIED", permission: ["hr.self.documents.upload", "hr.document.create", "hr.document.private.manage"] },
    { action: "expire", from: ["VERIFIED"], to: "EXPIRED", permission: "hr.document.verify" },
    { action: "supersede", from: ["UNVERIFIED", "VERIFIED", "EXPIRED", "REJECTED"], to: "SUPERSEDED", permission: ["hr.self.documents.upload", "hr.document.create", "hr.document.private.manage", "hr.compensation.update"] },
  ],
});
