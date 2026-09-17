import type { ProvisioningStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * An account request, from HR to Group IT (E-06 §27, §28, §92, §119).
 *
 * HR drafts the request from the employment it recorded and submits it. The
 * Head of Group HR or the Group Owner decides that the person gets an account;
 * Group IT then creates it, optionally marking the request as being worked on
 * first. Anybody who finds something wrong with the HR truth returns it to a
 * draft with a reason — Group IT never corrects it themselves (§29). A
 * provisioned, rejected or cancelled request is finished.
 */
export type ProvisioningAction = "submit" | "approve" | "reject" | "return" | "start" | "provision" | "cancel";

const APPROVE = "organization.provisioning_request.approve" as const;
const PROCESS = "organization.provisioning_request.process" as const;

export const provisioningRequestMachine = defineStateMachine<ProvisioningStatus, ProvisioningAction>({
  key: "user_provisioning_request",
  model: "userProvisioningRequest",
  field: "status",
  states: ["DRAFT", "SUBMITTED", "APPROVED", "IN_PROGRESS", "PROVISIONED", "REJECTED", "CANCELLED"],
  terminal: ["PROVISIONED", "REJECTED", "CANCELLED"],
  transitions: [
    { action: "submit", from: ["DRAFT"], to: "SUBMITTED", permission: "provisioning_request.submit" },
    { action: "approve", from: ["SUBMITTED"], to: "APPROVED", permission: APPROVE },
    { action: "reject", from: ["SUBMITTED"], to: "REJECTED", permission: APPROVE, requiresReason: true },
    { action: "return", from: ["SUBMITTED", "APPROVED", "IN_PROGRESS"], to: "DRAFT", permission: [APPROVE, PROCESS], requiresReason: true },
    { action: "start", from: ["APPROVED"], to: "IN_PROGRESS", permission: PROCESS },
    { action: "provision", from: ["APPROVED", "IN_PROGRESS"], to: "PROVISIONED", permission: "organization.user.provision", freezes: "everything" },
    { action: "cancel", from: ["DRAFT", "SUBMITTED", "APPROVED", "IN_PROGRESS"], to: "CANCELLED", permission: ["provisioning_request.create", PROCESS] },
  ],
});
