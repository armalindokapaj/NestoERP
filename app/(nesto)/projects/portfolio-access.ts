import { redirect } from "next/navigation";

import { requireModule, requireUserContext } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import { resolveProjectPortfolio, type PortfolioMembership } from "@/lib/modules/projects/project.portfolio";

/**
 * The Projects area's door (E-05A §1, §28).
 *
 * Somebody who can open projects in *any* of their companies may use the
 * Projects page — an architect whose session is in a company where they have
 * no project access still finds the projects they work on elsewhere. Somebody
 * who can open projects nowhere gets the same honest answer the module guard
 * gives: unavailable when their company switched Projects off, denied otherwise.
 */
export async function requireProjectPortfolio(): Promise<{ session: UserContext; portfolio: PortfolioMembership[] }> {
  const session = await requireUserContext();
  const portfolio = await resolveProjectPortfolio(session);
  if (portfolio.length > 0) return { session, portfolio };
  await requireModule("projects");
  redirect("/access-denied");
}
