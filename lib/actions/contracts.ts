"use server";

import { revalidatePath } from "next/cache";

import { AccessError } from "@/lib/access/guards";
import { committed } from "@/lib/forms/committed";
import { requireCompanyContext } from "@/lib/context/current-user";
import * as amendments from "@/lib/modules/contracts/amendments/amendment.service";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";
import * as obligations from "@/lib/modules/contracts/obligations/obligation.service";
import * as parties from "@/lib/modules/contracts/parties/party.service";
import {
  amendmentReasonSchema,
  amendmentSchema,
  amendmentSignedSchema,
} from "@/lib/modules/contracts/amendments/amendment.schema";
import {
  contractOwnerSchema,
  contractReasonSchema,
  contractSignedSchema,
  contractTerminationSchema,
  createContractSchema,
  updateContractMetadataSchema,
  updateContractSchema,
} from "@/lib/modules/contracts/contracts/contract.schema";
import {
  obligationSchema,
  obligationTaskSchema,
} from "@/lib/modules/contracts/obligations/obligation.schema";
import { contractPartySchema } from "@/lib/modules/contracts/parties/party.schema";

/**
 * Server actions for the Legal / Contracts module (PRD #18 §245, §282).
 *
 * A thin shell over the same services the API routes call. Nothing here decides
 * authorisation: every service re-runs the whole guard sequence, so a form
 * posting straight to an action is exactly as safe as the endpoint.
 */

export type ContractActionResult =
  | { ok: true; id?: string; message?: string; code?: string; redirectTo?: string }
  | { ok: false; error: string; code?: string; fieldErrors?: Record<string, string[]> };

function revalidateContracts(recordPath?: string) {
  revalidatePath("/contracts", "layout");
  if (recordPath) revalidatePath(recordPath, "layout");
  revalidatePath("/dashboard");
}

/**
 * Turns a service failure into something a form can render.
 *
 * `code` travels with the message because two of the module's conflicts are
 * questions rather than refusals: signing without a document on file, and an
 * amendment that reduces the terms. The form re-asks with a confirmation
 * instead of simply failing (PRD #18 §119, §168).
 */
function toResult(error: unknown): ContractActionResult {
  if (error instanceof AccessError) {
    const details = error.details as { code?: string } | undefined;
    return { ok: false, error: error.message, code: details?.code };
  }

  console.error("[contracts] action failed", error);
  return { ok: false, error: "We couldn't save your changes. Please try again." };
}

function invalid(error: { flatten(): { fieldErrors: unknown } }): ContractActionResult {
  return {
    ok: false,
    error: "Please review the highlighted fields.",
    fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
  };
}

function formValues(formData: FormData): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

/* -------------------------------------------------------------------------- */
/* Contracts                                                                   */
/* -------------------------------------------------------------------------- */

export async function createContractAction(formData: FormData): Promise<ContractActionResult> {
  const context = await requireCompanyContext();

  const parsed = createContractSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    const contract = await contracts.createContract(context, parsed.data);
    id = contract.id;
  } catch (error) {
    return toResult(error);
  }

  revalidateContracts();
  return committed(`/contracts/${id}`);
}

export async function updateContractAction(
  contractId: string,
  formData: FormData,
): Promise<ContractActionResult> {
  const context = await requireCompanyContext();

  const values = formValues(formData);
  // A body without a contract number is the metadata correction an approved
  // contract still allows (PRD #18 §107).
  const metadataOnly = values.contractNumber === undefined;

  const parsed = metadataOnly
    ? updateContractMetadataSchema.safeParse(values)
    : updateContractSchema.safeParse(values);
  if (!parsed.success) return invalid(parsed.error);

  try {
    if (metadataOnly) {
      await contracts.updateContractMetadata(
        context,
        contractId,
        parsed.data as Parameters<typeof contracts.updateContractMetadata>[2],
      );
    } else {
      await contracts.updateContract(
        context,
        contractId,
        parsed.data as Parameters<typeof contracts.updateContract>[2],
      );
    }
  } catch (error) {
    return toResult(error);
  }

  revalidateContracts(`/contracts/${contractId}`);
  return committed(`/contracts/${contractId}`);
}

export type ContractLifecycleAction =
  | "submit-review"
  | "submit-approval"
  | "approve"
  | "mark-sent"
  | "expire"
  | "archive"
  | "restore";

export async function contractLifecycleAction(
  contractId: string,
  action: ContractLifecycleAction,
  note?: string,
): Promise<ContractActionResult> {
  const context = await requireCompanyContext();

  try {
    if (action === "submit-review") await contracts.submitForReview(context, contractId);
    else if (action === "submit-approval") await contracts.submitForApproval(context, contractId);
    else if (action === "approve") await contracts.approveContract(context, contractId, note ?? null);
    else if (action === "mark-sent") await contracts.markSent(context, contractId);
    else if (action === "expire") await contracts.expireContract(context, contractId);
    else if (action === "archive") await contracts.archiveContract(context, contractId);
    else await contracts.restoreContract(context, contractId);
  } catch (error) {
    return toResult(error);
  }

  revalidateContracts(`/contracts/${contractId}`);
  return { ok: true };
}

export async function returnToDraftAction(
  contractId: string,
  note: string,
): Promise<ContractActionResult> {
  const context = await requireCompanyContext();

  try {
    await contracts.returnToDraft(context, contractId, note.trim() === "" ? null : note);
  } catch (error) {
    return toResult(error);
  }

  revalidateContracts(`/contracts/${contractId}`);
  return { ok: true };
}

export async function rejectContractAction(
  contractId: string,
  reason: string,
): Promise<ContractActionResult> {
  const context = await requireCompanyContext();

  const parsed = contractReasonSchema.safeParse({ note: reason });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await contracts.rejectContract(context, contractId, parsed.data.note);
  } catch (error) {
    return toResult(error);
  }

  revalidateContracts(`/contracts/${contractId}`);
  return { ok: true };
}

export async function markSignedAction(
  contractId: string,
  input: { signedDate: string; acknowledgeMissingDocument: boolean },
): Promise<ContractActionResult> {
  const context = await requireCompanyContext();

  const parsed = contractSignedSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await contracts.markSigned(context, contractId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateContracts(`/contracts/${contractId}`);
  return { ok: true };
}

export async function activateContractAction(
  contractId: string,
  effectiveDate?: string,
): Promise<ContractActionResult> {
  const context = await requireCompanyContext();

  try {
    await contracts.activateContract(
      context,
      contractId,
      effectiveDate && effectiveDate.trim() !== "" ? new Date(effectiveDate) : null,
    );
  } catch (error) {
    return toResult(error);
  }

  revalidateContracts(`/contracts/${contractId}`);
  return { ok: true };
}

export async function terminateContractAction(
  contractId: string,
  input: { terminationDate: string; terminationReason: string },
): Promise<ContractActionResult> {
  const context = await requireCompanyContext();

  const parsed = contractTerminationSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await contracts.terminateContract(context, contractId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateContracts(`/contracts/${contractId}`);
  return { ok: true };
}

export async function cancelContractAction(
  contractId: string,
  note: string,
): Promise<ContractActionResult> {
  const context = await requireCompanyContext();

  try {
    await contracts.cancelContract(context, contractId, note.trim() === "" ? null : note);
  } catch (error) {
    return toResult(error);
  }

  revalidateContracts(`/contracts/${contractId}`);
  return { ok: true };
}

export async function assignContractOwnerAction(
  contractId: string,
  ownerMemberId: string,
): Promise<ContractActionResult> {
  const context = await requireCompanyContext();

  const parsed = contractOwnerSchema.safeParse({ ownerMemberId });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await contracts.assignOwner(context, contractId, parsed.data.ownerMemberId);
  } catch (error) {
    return toResult(error);
  }

  revalidateContracts(`/contracts/${contractId}`);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Parties                                                                     */
/* -------------------------------------------------------------------------- */

export async function saveContractPartyAction(
  contractId: string,
  partyId: string | null,
  formData: FormData,
): Promise<ContractActionResult> {
  const context = await requireCompanyContext();

  const values = formValues(formData);
  const parsed = contractPartySchema.safeParse({
    ...values,
    isPrimaryCounterparty: values.isPrimaryCounterparty === "on" || values.isPrimaryCounterparty === "true",
  });
  if (!parsed.success) return invalid(parsed.error);

  try {
    if (partyId) await parties.updateParty(context, contractId, partyId, parsed.data);
    else await parties.addParty(context, contractId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateContracts(`/contracts/${contractId}`);
  return { ok: true };
}

export async function removeContractPartyAction(
  contractId: string,
  partyId: string,
): Promise<ContractActionResult> {
  const context = await requireCompanyContext();

  try {
    await parties.removeParty(context, contractId, partyId);
  } catch (error) {
    return toResult(error);
  }

  revalidateContracts(`/contracts/${contractId}`);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Obligations                                                                 */
/* -------------------------------------------------------------------------- */

export async function saveObligationAction(
  contractId: string,
  obligationId: string | null,
  formData: FormData,
): Promise<ContractActionResult> {
  const context = await requireCompanyContext();

  const parsed = obligationSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  try {
    if (obligationId) {
      await obligations.assertObligationOnContract(context, contractId, obligationId);
      await obligations.updateObligation(context, obligationId, parsed.data);
    } else {
      await obligations.createObligation(context, contractId, parsed.data);
    }
  } catch (error) {
    return toResult(error);
  }

  revalidateContracts(`/contracts/${contractId}`);
  return { ok: true };
}

export async function closeObligationAction(
  contractId: string,
  obligationId: string,
  action: "complete" | "cancel",
  note?: string,
): Promise<ContractActionResult> {
  const context = await requireCompanyContext();

  try {
    await obligations.assertObligationOnContract(context, contractId, obligationId);
    if (action === "complete") {
      await obligations.completeObligation(context, obligationId, note ?? null);
    } else {
      await obligations.cancelObligation(context, obligationId, note ?? null);
    }
  } catch (error) {
    return toResult(error);
  }

  revalidateContracts(`/contracts/${contractId}`);
  return { ok: true };
}

export async function createObligationTaskAction(
  contractId: string,
  obligationId: string,
  formData: FormData,
): Promise<ContractActionResult> {
  const context = await requireCompanyContext();

  const parsed = obligationTaskSchema.safeParse(formValues(formData));
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    await obligations.assertObligationOnContract(context, contractId, obligationId);
    const task = await obligations.createTaskForObligation(context, obligationId, parsed.data);
    id = task.id;
  } catch (error) {
    return toResult(error);
  }

  revalidateContracts(`/contracts/${contractId}`);
  revalidatePath("/tasks", "layout");
  return { ok: true, id, message: "Task created." };
}

/* -------------------------------------------------------------------------- */
/* Amendments                                                                  */
/* -------------------------------------------------------------------------- */

export async function saveAmendmentAction(
  contractId: string,
  amendmentId: string | null,
  formData: FormData,
): Promise<ContractActionResult> {
  const context = await requireCompanyContext();

  const values = formValues(formData);
  const parsed = amendmentSchema.safeParse({
    ...values,
    acknowledgeReduction:
      values.acknowledgeReduction === "on" || values.acknowledgeReduction === "true",
  });
  if (!parsed.success) return invalid(parsed.error);

  let id = amendmentId;
  try {
    if (amendmentId) {
      await amendments.assertAmendmentOnContract(context, contractId, amendmentId);
      await amendments.updateAmendment(context, amendmentId, parsed.data);
    } else {
      const created = await amendments.createAmendment(context, contractId, parsed.data);
      id = created.id;
    }
  } catch (error) {
    return toResult(error);
  }

  revalidateContracts(`/contracts/${contractId}`);
  return committed(`/contracts/${contractId}/amendments/${id}`);
}

export type AmendmentLifecycleAction =
  | "submit"
  | "approve"
  | "mark-sent"
  | "activate"
  | "cancel"
  | "archive";

export async function amendmentLifecycleAction(
  contractId: string,
  amendmentId: string,
  action: AmendmentLifecycleAction,
  note?: string,
): Promise<ContractActionResult> {
  const context = await requireCompanyContext();

  try {
    await amendments.assertAmendmentOnContract(context, contractId, amendmentId);
    if (action === "submit") await amendments.submitAmendment(context, amendmentId);
    else if (action === "approve") {
      await amendments.approveAmendment(context, amendmentId, note ?? null);
    } else if (action === "mark-sent") await amendments.markAmendmentSent(context, amendmentId);
    else if (action === "activate") await amendments.activateAmendment(context, amendmentId);
    else if (action === "cancel") {
      await amendments.cancelAmendment(context, amendmentId, note ?? null);
    } else await amendments.archiveAmendment(context, amendmentId);
  } catch (error) {
    return toResult(error);
  }

  revalidateContracts(`/contracts/${contractId}`);
  return { ok: true };
}

export async function rejectAmendmentAction(
  contractId: string,
  amendmentId: string,
  reason: string,
): Promise<ContractActionResult> {
  const context = await requireCompanyContext();

  const parsed = amendmentReasonSchema.safeParse({ note: reason });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await amendments.assertAmendmentOnContract(context, contractId, amendmentId);
    await amendments.rejectAmendment(context, amendmentId, parsed.data.note);
  } catch (error) {
    return toResult(error);
  }

  revalidateContracts(`/contracts/${contractId}`);
  return { ok: true };
}

export async function markAmendmentSignedAction(
  contractId: string,
  amendmentId: string,
  signedDate: string,
): Promise<ContractActionResult> {
  const context = await requireCompanyContext();

  const parsed = amendmentSignedSchema.safeParse({ signedDate });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await amendments.assertAmendmentOnContract(context, contractId, amendmentId);
    await amendments.markAmendmentSigned(context, amendmentId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateContracts(`/contracts/${contractId}`);
  return { ok: true };
}
