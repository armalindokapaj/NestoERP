import { z } from "zod";

import { optionalId, optionalText, requiredText } from "@/lib/modules/shared/fields";

/**
 * Contract party validation (PRD #18 §277, §278).
 *
 * The legal identity fields are snapshots, so they are plain text rather than a
 * lookup into Clients: what the contract said at signing is the fact, and a
 * later rename must not rewrite it (PRD #18 §141, §329).
 */

export const PARTY_ROLES = [
  "OUR_COMPANY",
  "CLIENT",
  "COUNTERPARTY",
  "GUARANTOR",
  "SUBCONTRACTOR",
  "OTHER",
] as const;

export const PARTY_TYPES = ["COMPANY", "INDIVIDUAL", "PUBLIC_ENTITY", "OTHER"] as const;

export const partyRoleLabels: Record<(typeof PARTY_ROLES)[number], string> = {
  OUR_COMPANY: "Our company",
  CLIENT: "Client",
  COUNTERPARTY: "Counterparty",
  GUARANTOR: "Guarantor",
  SUBCONTRACTOR: "Subcontractor",
  OTHER: "Other",
};

export const partyTypeLabels: Record<(typeof PARTY_TYPES)[number], string> = {
  COMPANY: "Company",
  INDIVIDUAL: "Individual",
  PUBLIC_ENTITY: "Public entity",
  OTHER: "Other",
};

export const contractPartySchema = z.object({
  partyRole: z.enum(PARTY_ROLES),
  partyType: z.enum(PARTY_TYPES),
  name: requiredText(2, 250, "Party name"),
  legalName: optionalText(250),
  registrationNumber: optionalText(80),
  taxId: optionalText(80),
  clientId: optionalId,
  address: optionalText(500),
  city: optionalText(120),
  country: optionalText(120),
  signatoryName: optionalText(200),
  signatoryTitle: optionalText(200),
  isPrimaryCounterparty: z.coerce.boolean().optional().default(false),
});

export type ContractPartyInput = z.infer<typeof contractPartySchema>;
