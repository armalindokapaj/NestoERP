import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { REQUEST_PATH_HEADER } from "@/lib/core/security/request-path";
import { getWorkProfile } from "@/lib/modules/people/people.service";
import { loadModuleRecord } from "@/components/modules/module-record-page";

import { loadClient } from "./clients/[clientId]/client-context";
import { loadDocument } from "./documents/[documentId]/document-context";
import { loadEmployee } from "./hr/employees/[employeeId]/employee-context";
import { loadInspectionPage } from "./qaqc/inspections/[inspectionId]/inspection-shell";
import { loadUnitPage } from "./projects/[projectId]/units/[unitId]/unit-page";
import { matchPreStreamRoute, type PreStreamRoute } from "./pre-stream-routes";
import { loadTask } from "./tasks/[taskId]/task-context";

/**
 * Pre-stream guards (NAV-01 §2.1).
 *
 * `app/(nesto)/loading.tsx` lets the shell flush before a page's own guard
 * has answered, so a refusal found below it arrives in the stream under a
 * 200. For most routes that is the agreed contract. These routes have a
 * documented one instead — their document answers 404 before any byte is sent
 * (their E2E specs assert it; see docs/navigation/NAV-01-route-inventory.md) —
 * so the shell's layout runs their guard first, above every loading boundary.
 *
 * Each guard is the route's own loader, not a copy: the loaders are cached
 * per request, so the page reuses the answer instead of asking twice. A
 * refusal thrown here is a real 404 (or redirect); the page is then drawn by
 * the root not-found screen. Client-side navigation does not re-render this
 * layout and keeps the in-shell not-found, streamed like any other page.
 *
 * Adding a route here is adding a status contract: keep the list short.
 */

type Guard = { route: PreStreamRoute; run: (match: RegExpMatchArray) => Promise<unknown> };

const decode = (value: string) => decodeURIComponent(value);

function notFoundOn(error: unknown): never {
  if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
  throw error;
}

export const PRE_STREAM_GUARDS: Guard[] = [
  { route: "/clients/[clientId]", run: ([, id]) => loadClient(decode(id)) },
  { route: "/documents/[documentId]", run: ([, id]) => loadDocument(decode(id)) },
  { route: "/tasks/[taskId]", run: ([, id]) => loadTask(decode(id)) },
  { route: "/hr/employees/[employeeId]", run: ([, id]) => loadEmployee(decode(id)) },
  {
    route: "/hr/employees/[employeeId]/compensation",
    run: async ([, id]) => {
      const { employee } = await loadEmployee(decode(id), "/compensation");
      if (!employee.capabilities.canViewCompensation) notFound();
    },
  },
  { route: "/projects/[projectId]/units/[unitId]", run: ([, projectId, unitId]) => loadUnitPage(decode(projectId), decode(unitId)) },
  {
    route: "/projects/types",
    run: async () => {
      if (!can(await requireModule("projects"), "project.type.manage")) notFound();
    },
  },
  {
    route: "/people/[personId]",
    run: async ([, id]) => getWorkProfile(await requireModule("people"), decode(id)).catch(notFoundOn),
  },
  { route: "/support/[section]/[recordId]", run: ([, section, id]) => loadModuleRecord("support", decode(section), decode(id)) },
  { route: "/qaqc/inspections/[inspectionId]", run: ([, id]) => loadInspectionPage(decode(id), "overview") },
];

/** The guard for this path, if it has a pre-stream status contract. */
export function preStreamGuardFor(pathname: string): (() => Promise<unknown>) | null {
  const matched = matchPreStreamRoute(pathname);
  const guard = matched ? PRE_STREAM_GUARDS.find((entry) => entry.route === matched.route) : undefined;
  return guard && matched ? () => guard.run(matched.match) : null;
}

/** Runs the current document's pre-stream guard, if it has one. A refusal propagates as the route's own 404 or redirect. */
export async function runPreStreamGuard(): Promise<void> {
  let path: string | null = null;
  try {
    path = (await headers()).get(REQUEST_PATH_HEADER);
  } catch {
    return;
  }
  const guard = path ? preStreamGuardFor(path.split("?")[0]) : null;
  if (guard) await guard();
}
