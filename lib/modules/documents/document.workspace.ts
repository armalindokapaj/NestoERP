import { sectionRoute } from "@/config/modules";
import { inGroupWorkspace, isGroupRoute } from "@/config/workspace";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { ResolvedModuleExperience } from "@/lib/access/module-access";
import { resolveWorkspaceContexts } from "@/lib/context/workspace-access";
import type { UserContext } from "@/lib/context/types";
import { paginationMeta } from "@/lib/modules/shared/list-query";
import * as repository from "./document.repository";
import type { DocumentListQuery } from "./document.schema";
import * as documents from "./document.service";
import type { DocumentOverviewStats, DocumentSummaryDTO } from "./document.types";

/**
 * Documents in the active workspace (Workspace Context §35, §45, §86, §87).
 *
 * There is one Documents module and one document system. In a company workspace
 * these entry points are the company's own service, untouched. In the Group
 * workspace they ask each company the reader may use Documents in for its own
 * answer — the access clause its own pages apply, parent access and record
 * registry included — and read the union, so a group list never shows a file
 * that company's list would keep from this person (§57, §62). Each company's
 * module switch and `document.view` grant is honoured on its own (§60): one that
 * is off, or not held, contributes nothing.
 *
 * Nothing here writes, opens or downloads a file. A row opens through its own
 * company's `/documents/[id]`, where that company's rules and storage answer.
 */

/**
 * The contexts the active workspace reads documents with: the session's own in
 * a company workspace, the person's context in each authorised company in the
 * Group workspace. Nobody holding Documents anywhere is refused with the answer
 * the company guards give, not shown an empty list that looks like a fact.
 */
export async function resolveDocumentReaders(session: UserContext): Promise<UserContext[]> {
  const readers = await resolveWorkspaceContexts(session, { module: "documents", permission: "document.view" });
  if (readers.length > 0) return readers;
  assertModule(session, "documents");
  assertPermission(session, "document.view");
  throw new AccessError("FORBIDDEN");
}

/**
 * Narrows a group read to the company a filter names (§87) — if the reader may
 * read it. A company they may not read, or that does not exist, narrows nothing
 * and says nothing: the filter is ignored, so it cannot be used to find out
 * which companies exist or what they hold (§57, §81).
 */
function narrowToCompany(readers: UserContext[], companyId: string | undefined): UserContext[] {
  if (!companyId) return readers;
  const chosen = readers.filter((reader) => reader.companyId === companyId);
  return chosen.length > 0 ? chosen : readers;
}

/** The companies a Group workspace list can be narrowed to: the ones it reads, never a list a browser sent (§57). */
export async function listDocumentCompanies(session: UserContext): Promise<Array<{ id: string; name: string }>> {
  if (!inGroupWorkspace(session)) return [];
  return (await resolveDocumentReaders(session)).map((reader) => ({ id: reader.company.id, name: reader.company.name }));
}

/** The document list of the active workspace; in a group, rows of every readable company, each labelled with its own. */
export async function listDocumentsForWorkspace(session: UserContext, query: DocumentListQuery) {
  if (!inGroupWorkspace(session)) return documents.listDocuments(session, query);

  const readers = narrowToCompany(await resolveDocumentReaders(session), query.companyId);
  const { rows, total } = await repository.listDocumentsAcross(readers, query);

  return { data: labelled(readers, rows), pagination: paginationMeta(total, query.page, query.limit) };
}

export async function getDocumentOverviewForWorkspace(session: UserContext): Promise<DocumentOverviewStats> {
  if (!inGroupWorkspace(session)) return documents.getDocumentOverview(session);
  return repository.documentOverviewStatsAcross(await resolveDocumentReaders(session));
}

export async function listRecentForWorkspace(session: UserContext, take = 6): Promise<DocumentSummaryDTO[]> {
  if (!inGroupWorkspace(session)) return documents.listRecent(session, take);
  const readers = await resolveDocumentReaders(session);
  return labelled(readers, await repository.recentDocumentsAcross(readers, take));
}

export async function listMyUploadsForWorkspace(session: UserContext, take = 6): Promise<DocumentSummaryDTO[]> {
  if (!inGroupWorkspace(session)) return documents.listMyUploads(session, take);
  const readers = await resolveDocumentReaders(session);
  return labelled(readers, await repository.myRecentUploadsAcross(readers, take));
}

/** Filter dropdown values of the active workspace, narrowed to the chosen company in a group. */
export async function documentFilterOptionsForWorkspace(session: UserContext, companyId?: string) {
  if (!inGroupWorkspace(session)) return repository.documentFilterOptions(session);
  return repository.documentFilterOptionsAcross(narrowToCompany(await resolveDocumentReaders(session), companyId));
}

/**
 * Names each row's company from the contexts that admitted it. A row whose
 * company is not one of them cannot come out of the access clause; if it ever
 * did, it is dropped rather than shown unlabelled.
 */
function labelled(readers: UserContext[], rows: repository.DocumentSummaryRow[]): DocumentSummaryDTO[] {
  const companies = new Map(readers.map((reader) => [reader.companyId, { id: reader.company.id, name: reader.company.name }]));
  return rows.flatMap((row) => {
    const company = companies.get(row.companyId);
    return company ? [documents.toGroupSummaryDTO(row, company)] : [];
  });
}

/**
 * The module's tab bar in the active workspace. In the Group workspace only the
 * sections that answer for the whole group are offered — a tab that leads to
 * "choose a company" is not a tab (§25, §29).
 */
export function workspaceExperience(session: UserContext, experience: ResolvedModuleExperience): ResolvedModuleExperience {
  if (!inGroupWorkspace(session)) return experience;
  return {
    ...experience,
    sections: experience.sections.filter((section) => isGroupRoute(experience.module, sectionRoute(experience.module, section.key))),
  };
}
