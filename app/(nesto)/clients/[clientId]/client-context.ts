import { notFound } from "next/navigation";
import type { Crumb } from "@/components/ui/breadcrumbs";

import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import * as clients from "@/lib/modules/clients/client.service";
import type { ClientDetailDTO } from "@/lib/modules/clients/client.types";

/**
 * Loads a client for every page under /clients/[clientId] (PRD #12 §56).
 *
 * A client outside the caller's scope is a 404, not a 403, so the page itself
 * cannot be used to discover that it exists (PRD #12 §129).
 */
export async function loadClient(
  clientId: string,
): Promise<{ context: UserContext; client: ClientDetailDTO }> {
  const context = await requireModule("clients");

  try {
    return { context, client: await clients.getClient(context, clientId) };
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export function clientBreadcrumbs(client: ClientDetailDTO, trailing?: string): Crumb[] {
  const crumbs: Crumb[] = [
    { label: "Clients", href: "/clients" },
    trailing ? { label: client.name, href: `/clients/${client.id}` } : { label: client.name },
  ];
  if (trailing) crumbs.push({ label: trailing });
  return crumbs;
}
