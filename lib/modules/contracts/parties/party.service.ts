import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import { buildClientScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { buildContractClientWhere, buildContractScopeWhere } from "../contract.scope";
import type { ContractPartyDTO } from "../contract.types";
import { arePartiesEditable, isPartyRemovable } from "../contracts/contract.status";
import type { ContractPartyInput } from "./party.schema";

/**
 * Contract parties (PRD #18 §136–§147).
 *
 * A party is a **snapshot**. Even when it links to a Client, the name, legal
 * name and address are what the agreement said when it was signed — renaming
 * the customer afterwards must not rewrite who signed (PRD #18 §141, §329,
 * §429).
 *
 * Parties are terms of the agreement, so they freeze when it does: editable
 * while the contract is a draft or in review, and changed by amendment
 * afterwards (PRD #18 §145).
 */

const MODULE = "contracts" as const;
const ENTITY = "Contract";

const PARTY_SELECT = {
  id: true,
  contractId: true,
  partyRole: true,
  partyType: true,
  name: true,
  legalName: true,
  registrationNumber: true,
  taxId: true,
  clientId: true,
  address: true,
  city: true,
  country: true,
  signatoryName: true,
  signatoryTitle: true,
  isPrimaryCounterparty: true,
} satisfies Prisma.ContractPartySelect;

export async function listParties(
  context: UserContext,
  contractId: string,
): Promise<ContractPartyDTO[]> {
  if (!can(context, "legal.party.view")) return [];

  const rows = await prisma.contractParty.findMany({
    where: { contractId, contract: { is: buildContractScopeWhere(context) } },
    orderBy: [{ isPrimaryCounterparty: "desc" }, { partyRole: "asc" }, { name: "asc" }],
    select: PARTY_SELECT,
  });

  return rows.map(toDTO);
}

/**
 * The clients a party may be linked to (PRD #18 §142, §297).
 *
 * Resolved through the caller's own Clients access, so the picker never becomes
 * a directory of customers they cannot open. Linking is optional: a
 * counterparty who is not a customer of ours is named on the party row and
 * nowhere else.
 */
export async function partyClientOptions(
  context: UserContext,
): Promise<{ value: string; label: string }[]> {
  if (!can(context, "legal.party.manage")) return [];

  const clients = await prisma.client.findMany({
    where: buildContractClientWhere(context),
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return clients.map((client) => ({ value: client.id, label: client.name }));
}

export async function addParty(
  context: UserContext,
  contractId: string,
  input: ContractPartyInput,
): Promise<ContractPartyDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "legal.party.manage");

  const contract = await requireEditableContract(context, contractId);
  const clientId = input.clientId ? await resolveClient(context, input.clientId) : null;

  const partyId = await prisma.$transaction(async (tx) => {
    if (input.isPrimaryCounterparty) await clearPrimary(tx, contractId, null);

    const party = await tx.contractParty.create({
      data: {
        companyId: context.companyId,
        contractId,
        partyRole: input.partyRole,
        partyType: input.partyType,
        name: input.name,
        legalName: input.legalName ?? null,
        registrationNumber: input.registrationNumber ?? null,
        taxId: input.taxId ?? null,
        clientId,
        address: input.address ?? null,
        city: input.city ?? null,
        country: input.country ?? null,
        signatoryName: input.signatoryName ?? null,
        signatoryTitle: input.signatoryTitle ?? null,
        isPrimaryCounterparty: input.isPrimaryCounterparty,
      },
      select: { id: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: contractId,
      action: "LEGAL_PARTY_ADDED",
      message: `added ${input.name} to contract ${contract.contractNumber}`,
      metadata: { partyRole: input.partyRole } as Prisma.InputJsonValue,
    });

    return party.id;
  });

  const row = assertFound(
    await prisma.contractParty.findUnique({ where: { id: partyId }, select: PARTY_SELECT }),
  );
  return toDTO(row);
}

export async function updateParty(
  context: UserContext,
  contractId: string,
  partyId: string,
  input: ContractPartyInput,
): Promise<ContractPartyDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "legal.party.manage");

  const contract = await requireEditableContract(context, contractId);
  const existing = assertFound(
    await prisma.contractParty.findFirst({
      where: { id: partyId, contractId },
      select: { id: true, name: true },
    }),
  );

  const clientId = input.clientId ? await resolveClient(context, input.clientId) : null;

  await prisma.$transaction(async (tx) => {
    if (input.isPrimaryCounterparty) await clearPrimary(tx, contractId, partyId);

    await tx.contractParty.update({
      where: { id: partyId },
      data: {
        partyRole: input.partyRole,
        partyType: input.partyType,
        name: input.name,
        legalName: input.legalName ?? null,
        registrationNumber: input.registrationNumber ?? null,
        taxId: input.taxId ?? null,
        clientId,
        address: input.address ?? null,
        city: input.city ?? null,
        country: input.country ?? null,
        signatoryName: input.signatoryName ?? null,
        signatoryTitle: input.signatoryTitle ?? null,
        isPrimaryCounterparty: input.isPrimaryCounterparty,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: contractId,
      action: "LEGAL_PARTY_UPDATED",
      message: `updated ${existing.name} on contract ${contract.contractNumber}`,
    });
  });

  const row = assertFound(
    await prisma.contractParty.findUnique({ where: { id: partyId }, select: PARTY_SELECT }),
  );
  return toDTO(row);
}

/**
 * Removes a party row (PRD #18 §146).
 *
 * Only while the contract is a draft. Once anybody has reviewed or approved it,
 * the list of parties is part of what they agreed to, and deleting a row would
 * quietly change the record they signed off.
 */
export async function removeParty(
  context: UserContext,
  contractId: string,
  partyId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "legal.party.manage");

  const contract = assertFound(
    await prisma.contract.findFirst({
      where: { AND: [buildContractScopeWhere(context), { id: contractId }] },
      select: { id: true, contractNumber: true, status: true, archivedAt: true },
    }),
  );

  if (contract.archivedAt || !isPartyRemovable(contract.status)) {
    throw new AccessError(
      "CONFLICT",
      "A party can only be removed while the contract is still a draft. Record the change as an amendment instead.",
    );
  }

  const existing = assertFound(
    await prisma.contractParty.findFirst({
      where: { id: partyId, contractId },
      select: { id: true, name: true },
    }),
  );

  await prisma.$transaction(async (tx) => {
    await tx.contractParty.delete({ where: { id: partyId } });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: contractId,
      action: "LEGAL_PARTY_REMOVED",
      message: `removed ${existing.name} from contract ${contract.contractNumber}`,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function requireEditableContract(context: UserContext, contractId: string) {
  const contract = assertFound(
    await prisma.contract.findFirst({
      where: { AND: [buildContractScopeWhere(context), { id: contractId }] },
      select: { id: true, contractNumber: true, status: true, archivedAt: true },
    }),
  );

  if (contract.archivedAt || !arePartiesEditable(contract.status)) {
    throw new AccessError(
      "CONFLICT",
      "The parties to an approved contract change by amendment, not by editing.",
    );
  }

  return contract;
}

/**
 * At most one primary counterparty (PRD #18 §144, §236, §319).
 *
 * Cleared inside the same transaction that sets the new one, and backed by a
 * partial unique index — so two people promoting different parties at the same
 * moment produce one winner and one conflict, not two primaries.
 */
async function clearPrimary(
  tx: Prisma.TransactionClient,
  contractId: string,
  exceptId: string | null,
): Promise<void> {
  await tx.contractParty.updateMany({
    where: {
      contractId,
      isPrimaryCounterparty: true,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    data: { isPrimaryCounterparty: false },
  });
}

/** A client inside the caller's own Clients scope, not merely the company (PRD #47 §20, §64). */
async function resolveClient(context: UserContext, clientId: string): Promise<string> {
  const client = await prisma.client.findFirst({
    where: { AND: [buildClientScopeWhere(context), { id: clientId }] },
    select: { id: true },
  });
  if (!client) {
    throw new AccessError("VALIDATION_ERROR", "That client does not exist.");
  }
  return client.id;
}

function toDTO(row: Prisma.ContractPartyGetPayload<{ select: typeof PARTY_SELECT }>): ContractPartyDTO {
  return {
    id: row.id,
    role: row.partyRole,
    type: row.partyType,
    name: row.name,
    legalName: row.legalName,
    registrationNumber: row.registrationNumber,
    taxId: row.taxId,
    clientId: row.clientId,
    address: row.address,
    city: row.city,
    country: row.country,
    signatoryName: row.signatoryName,
    signatoryTitle: row.signatoryTitle,
    isPrimaryCounterparty: row.isPrimaryCounterparty,
  };
}
