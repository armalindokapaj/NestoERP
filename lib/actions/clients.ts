"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { AccessError } from "@/lib/access/guards";
import { requireCompanyContext } from "@/lib/context/current-user";
import type { DuplicateMatch } from "@/lib/modules/clients/client.duplicate";
import {
  createClientSchema,
  createContactSchema,
  updateClientSchema,
  updateContactSchema,
} from "@/lib/modules/clients/client.schema";
import * as clients from "@/lib/modules/clients/client.service";

/**
 * Server actions for the Clients module (PRD #12 §109).
 *
 * They are a thin shell over the same service the API routes call — the
 * authorisation, validation and transaction logic exists once.
 */

/**
 * A client change moves it between /clients/all, /clients/active and
 * /clients/archived, and shows up on the projects that reference it — so the
 * subtree is revalidated rather than one path (PRD #12 §244).
 */
function revalidateClients(clientId?: string) {
  revalidatePath("/clients", "layout");
  if (clientId) revalidatePath(`/clients/${clientId}`, "layout");
  revalidatePath("/projects", "layout");
  revalidatePath("/dashboard");
}

export type ClientActionResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      fieldErrors?: Record<string, string[]>;
      /** Present when the refusal was a soft duplicate (PRD #12 §53). */
      duplicates?: DuplicateMatch[];
    };

function toResult(error: unknown): ClientActionResult {
  if (error instanceof clients.DuplicateClientError) {
    return { ok: false, error: error.message, duplicates: error.matches };
  }
  if (error instanceof AccessError) return { ok: false, error: error.message };
  // Never surface a raw database error to a person.
  console.error("[clients] action failed", error);
  return { ok: false, error: "We couldn't save your changes. Please try again." };
}

function formValues(formData: FormData): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

export async function createClientAction(formData: FormData): Promise<ClientActionResult> {
  const context = await requireCompanyContext();

  const parsed = createClientSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please review the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  let clientId: string;
  try {
    const client = await clients.createClient(context, parsed.data);
    clientId = client.id;
  } catch (error) {
    return toResult(error);
  }

  revalidateClients(clientId);
  redirect(`/clients/${clientId}`);
}

export async function updateClientAction(
  clientId: string,
  formData: FormData,
): Promise<ClientActionResult> {
  const context = await requireCompanyContext();

  const parsed = updateClientSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please review the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  try {
    await clients.updateClient(context, clientId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateClients(clientId);
  redirect(`/clients/${clientId}`);
}

export async function archiveClientAction(clientId: string): Promise<ClientActionResult> {
  const context = await requireCompanyContext();
  try {
    await clients.archiveClient(context, clientId);
  } catch (error) {
    return toResult(error);
  }
  revalidateClients(clientId);
  return { ok: true };
}

export async function restoreClientAction(clientId: string): Promise<ClientActionResult> {
  const context = await requireCompanyContext();
  try {
    await clients.restoreClient(context, clientId);
  } catch (error) {
    return toResult(error);
  }
  revalidateClients(clientId);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Contacts                                                                    */
/* -------------------------------------------------------------------------- */

export async function createContactAction(
  clientId: string,
  formData: FormData,
): Promise<ClientActionResult> {
  const context = await requireCompanyContext();

  const parsed = createContactSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please review the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  try {
    await clients.createContact(context, clientId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateClients(clientId);
  return { ok: true };
}

export async function updateContactAction(
  clientId: string,
  contactId: string,
  formData: FormData,
): Promise<ClientActionResult> {
  const context = await requireCompanyContext();

  const parsed = updateContactSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please review the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  try {
    await clients.updateContact(context, clientId, contactId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateClients(clientId);
  return { ok: true };
}

export async function makePrimaryContactAction(
  clientId: string,
  contactId: string,
): Promise<ClientActionResult> {
  const context = await requireCompanyContext();
  try {
    await clients.makePrimaryContact(context, clientId, contactId);
  } catch (error) {
    return toResult(error);
  }
  revalidateClients(clientId);
  return { ok: true };
}

export async function archiveContactAction(
  clientId: string,
  contactId: string,
): Promise<ClientActionResult> {
  const context = await requireCompanyContext();
  try {
    await clients.archiveContact(context, clientId, contactId);
  } catch (error) {
    return toResult(error);
  }
  revalidateClients(clientId);
  return { ok: true };
}

export async function restoreContactAction(
  clientId: string,
  contactId: string,
): Promise<ClientActionResult> {
  const context = await requireCompanyContext();
  try {
    await clients.restoreContact(context, clientId, contactId);
  } catch (error) {
    return toResult(error);
  }
  revalidateClients(clientId);
  return { ok: true };
}
