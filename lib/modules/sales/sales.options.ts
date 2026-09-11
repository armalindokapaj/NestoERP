import { prisma } from "@/lib/database/prisma";
import type { UserContext } from "@/lib/context/types";
import { buildSalesClientWhere, buildSalesOwnerWhere, buildSalesProjectWhere } from "./sales.scope";

/**
 * The options a Sales form may offer (PRD #17 §218–§220).
 *
 * Every picker is built from a scoped query rather than a company-wide one, so
 * a form cannot propose a client, a project or a member the person filling it
 * in could not otherwise see (PRD #17 §338).
 */

export type Option = { value: string; label: string };

/** Active members of this company. Never another company's (PRD #17 §220). */
export async function salesOwnerOptions(context: UserContext): Promise<Option[]> {
  const members = await prisma.companyMember.findMany({
    where: buildSalesOwnerWhere(context),
    select: { id: true, user: { select: { firstName: true, lastName: true } } },
    orderBy: [{ user: { lastName: "asc" } }, { user: { firstName: "asc" } }],
  });

  return members.map((member) => ({
    value: member.id,
    label: `${member.user.firstName} ${member.user.lastName}`,
  }));
}

/**
 * Clients, with their contacts, for the opportunity form (PRD #17 §218, §219).
 *
 * The contacts travel with their client so the browser can narrow the second
 * dropdown without a round trip — and the server refuses a mismatched pair
 * regardless (PRD #17 §65).
 */
export async function salesClientOptions(context: UserContext) {
  const clients = await prisma.client.findMany({
    where: buildSalesClientWhere(context),
    select: {
      id: true,
      name: true,
      contacts: {
        where: { archivedAt: null, status: "ACTIVE" },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ isPrimary: "desc" }, { lastName: "asc" }],
      },
    },
    orderBy: { name: "asc" },
  });

  return clients.map((client) => ({
    value: client.id,
    label: client.name,
    contacts: client.contacts.map((contact) => ({
      value: contact.id,
      label: `${contact.firstName} ${contact.lastName}`,
    })),
  }));
}

/** Projects a won deal may hand over to (PRD #17 §89). */
export async function salesProjectOptions(
  context: UserContext,
  clientId: string | null,
): Promise<Option[]> {
  const projects = await prisma.project.findMany({
    where: {
      AND: [
        buildSalesProjectWhere(context),
        // A project belonging to a different client would be refused on save,
        // so it is not offered (PRD #17 §89).
        clientId ? { OR: [{ clientId }, { clientId: null }] } : {},
      ],
    },
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  });

  return projects.map((project) => ({
    value: project.id,
    label: `${project.code} — ${project.name}`,
  }));
}

/** Open opportunities a proposal may be raised against (PRD #17 §109, §110). */
export async function proposalOpportunityOptions(context: UserContext): Promise<Option[]> {
  const { buildOpportunityScopeWhere } = await import("./sales.scope");

  const opportunities = await prisma.opportunity.findMany({
    where: {
      AND: [
        buildOpportunityScopeWhere(context),
        {
          archivedAt: null,
          stage: { notIn: ["WON", "LOST"] },
          // A proposal has to be addressed to somebody (PRD #17 §110).
          clientId: { not: null },
        },
      ],
    },
    select: { id: true, name: true, client: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  return opportunities.map((opportunity) => ({
    value: opportunity.id,
    label: opportunity.client
      ? `${opportunity.name} — ${opportunity.client.name}`
      : opportunity.name,
  }));
}
