import type { RfiStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The RFI lifecycle (PRD #46 §82-§97; PRD #49 §142-§145).
 *
 *   DRAFT → OPEN → ANSWERED → CLOSED, with ANSWERED → CLARIFICATION_REQUIRED → ANSWERED
 *
 * An RFI raised as "open now" is created `OPEN`, so `open` is not the only way
 * in. Answering is legal from `ANSWERED` too: a response is appended and never
 * edited, so a correction or a further answer is another response and the RFI
 * stays answered (§143). Who may answer — the assignee, or somebody who may
 * close RFIs — is the service's check (`RFI_NOT_ASSIGNED`), above the grant
 * declared here.
 *
 * Closing needs an answer (§144): an RFI waiting on clarification goes back to
 * the assignee first. Nothing reopens a closed RFI yet — §145 describes an
 * explicit reopen with a reason, and no service implements one.
 */
export type RfiAction = "open" | "respond" | "request_clarification" | "close" | "void";

export const rfiMachine = defineStateMachine<RfiStatus, RfiAction>({
  key: "rfi",
  model: "rfi",
  field: "status",
  states: ["DRAFT", "OPEN", "ANSWERED", "CLARIFICATION_REQUIRED", "CLOSED", "VOID"],
  terminal: ["CLOSED", "VOID"],
  transitions: [
    { action: "open", from: ["DRAFT"], to: "OPEN", permission: "rfi.open", freezes: "the subject and the question" },
    { action: "respond", from: ["OPEN", "ANSWERED", "CLARIFICATION_REQUIRED"], to: "ANSWERED", permission: "rfi.respond" },
    { action: "request_clarification", from: ["ANSWERED"], to: "CLARIFICATION_REQUIRED", permission: "rfi.edit" },
    { action: "close", from: ["ANSWERED"], to: "CLOSED", permission: "rfi.close", freezes: "the whole RFI, its responses and its references" },
    { action: "void", from: ["DRAFT", "OPEN", "ANSWERED", "CLARIFICATION_REQUIRED"], to: "VOID", permission: "rfi.void", requiresReason: true, freezes: "the whole RFI" },
  ],
});
