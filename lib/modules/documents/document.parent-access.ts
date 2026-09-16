import type { Prisma } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import { can, getModuleScope } from "@/lib/access/can";
import { MODULE_KEYS, type ModuleKey } from "@/config/modules";
import type { Permission } from "@/config/permissions";
import { buildClientScopeWhere, buildProjectScopeWhere } from "@/lib/access/scope";
import { prisma } from "@/lib/database/prisma";
import type { UserContext } from "@/lib/context/types";
import {
  loadRecord,
  moduleAndPermissions,
  recordDefinition,
  recordDefinitions,
} from "@/lib/core/records/record.registry";
import { isRecordType, type RecordDefinition, type RecordSummary, type RecordType } from "@/lib/core/records/record.types";
import type { CreateDocumentInput } from "./document.schema";

/**
 * Document parent access (PRD #13 §42–§45, PRD #38 §52, §53, §66).
 *
 * A generic `document.view` is never enough. Every document is reachable only
 * through its parent:
 *
 *   document permission + parent module permission + parent record access
 *   + company isolation (+ safe storage state, enforced by the storage layer)
 *
 * The parent is decided by the record registry in `lib/core/records` — the
 * same definitions collaboration and notification links use. There is no
 * separate list of readable types here, none of uploadable types, and no
 * per-type resolver: read, upload, list, search, labels and return routes all
 * come from one entry, so they cannot drift apart again (PRD #38 §52).
 *
 * An unregistered parent **fails closed**: excluded from lists, refused on
 * detail, refused on upload.
 */

export type DocumentParentRef = {
  projectId: string | null;
  clientId: string | null;
  module: string | null;
  entityType: string | null;
  entityId: string | null;
};

export type DocumentParentKind =
  | { kind: "project"; projectId: string }
  | { kind: "client"; clientId: string }
  | { kind: "record"; type: RecordType; id: string; definition: RecordDefinition }
  | { kind: "company"; module: string | null }
  | { kind: "unregistered" };

/**
 * What a document hangs off.
 *
 * A module record wins over a project id: a hazard photo filed with the
 * hazard's project attached is reachable through the hazard — its HSE
 * permissions and its scope — not through project membership alone. Deciding
 * the other way round is how an incident photograph used to be readable by
 * anyone on the project who could open the HSE module at all.
 */
export function classifyDocumentParent(ref: DocumentParentRef): DocumentParentKind {
  const entityType = ref.entityType;

  if (entityType && entityType !== "project" && entityType !== "client") {
    const definition = recordDefinition(entityType);
    if (!definition?.documents || !ref.entityId || !isRecordType(entityType)) return { kind: "unregistered" };
    return { kind: "record", type: entityType, id: ref.entityId, definition };
  }

  if (ref.projectId) return { kind: "project", projectId: ref.projectId };
  if (entityType === "project" && ref.entityId) return { kind: "project", projectId: ref.entityId };
  if (ref.clientId) return { kind: "client", clientId: ref.clientId };
  if (entityType === "client" && ref.entityId) return { kind: "client", clientId: ref.entityId };
  if (entityType) return { kind: "unregistered" };

  return { kind: "company", module: ref.module };
}

/* -------------------------------------------------------------------------- */
/* Module gate                                                                 */
/* -------------------------------------------------------------------------- */

function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}

/** Modules the caller may reach at all. */
function reachableModules(context: UserContext): ModuleKey[] {
  return (Object.keys(context.moduleAccess) as ModuleKey[]).filter((key) => {
    const access = context.moduleAccess[key];
    return access.enabled && access.accessLevel !== "NONE";
  });
}

/**
 * Modules the caller reaches at *company* level.
 *
 * A company-level document has no project or client to narrow it, so it needs
 * company-level access to the module it was filed under. That is what keeps
 * "Company Financial Summary.pdf" away from an Architect whose Finance access
 * is scoped to their own projects (PRD #13 §39, §46, §202, §283) — and, being
 * built from `documentModules`, it carries the module's document grant too, so
 * "Employee HR Record.pdf" stays away from an Administrator who reaches HR at
 * company level without `hr.document.view` (PRD #47 §98).
 */
function companyLevelModules(context: UserContext): ModuleKey[] {
  return documentModules(context).filter((key) => {
    const scope = getModuleScope(context, key);
    return scope === "COMPANY" || scope === "SYSTEM";
  });
}

/**
 * The document-read grant each filing module adds on top of reaching the
 * module (PRD #13 §46, PRD #47 §81, §98, §99).
 *
 * Reaching a module is not reading its files. An Administrator who opens HR to
 * look after its settings has not been handed the employee file drawer, and a
 * Project Manager whose Sales access is project-scoped has not been handed the
 * proposals filed against a client. A document filed under a module — hanging
 * off a project, a client, or nothing at all — needs that module's own
 * document grant as well.
 *
 * A module with no entry takes no such documents: anything filed under it
 * fails closed. Record documents are the exception only in where the grant is
 * written down — their registry definition names it (`documents.view`).
 */
const MODULE_DOCUMENT_VIEW: Partial<Record<ModuleKey, Permission>> = {
  projects: "project.document.view",
  clients: "client.document.view",
  finance: "finance.document.view",
  hr: "hr.document.view",
  sales: "sales.document.view",
  contracts: "legal.document.view",
  procurement: "procurement.document.view",
  inventory: "inventory.document.view",
  qaqc: "qaqc.document.view",
  hse: "hse.document.view",
  meetings: "meeting.document.view",
  // Site evidence is read with the log itself; the module has no separate file grant (PRD #43 §74).
  dailyLogs: "daily_log.view",
  // Company-wide files are what the company-document grant exists for (PRD #13 §39, §47).
  company: "document.company.view",
};

/** Modules whose filed documents the caller may read: reachable, and the module's document grant held. */
function documentModules(context: UserContext): ModuleKey[] {
  return reachableModules(context).filter((key) => {
    const permission = MODULE_DOCUMENT_VIEW[key];
    return permission !== undefined && can(context, permission);
  });
}

/**
 * The filing-module half of the formula for one document.
 *
 * A record document labelled with its own record's module is governed by that
 * record's definition, which already requires its document grant; anything else
 * — a project, client or company document, or a record document filed under a
 * different module — needs the filing module's document grant.
 */
function filingModuleAllowed(context: UserContext, ref: DocumentParentRef, parent: DocumentParentKind): boolean {
  if (ref.module === null) return true;
  if (!isModuleKey(ref.module)) return false; // fail closed on an unknown module
  if (parent.kind === "record" && parent.definition.moduleKey === ref.module) {
    return reachableModules(context).includes(ref.module);
  }
  return documentModules(context).includes(ref.module);
}

/* -------------------------------------------------------------------------- */
/* Single parent                                                               */
/* -------------------------------------------------------------------------- */

/** The record's own permissions plus its document-read permissions. */
function recordDocumentReadHeld(context: UserContext, definition: RecordDefinition): boolean {
  const documents = definition.documents;
  if (!documents) return false;
  return moduleAndPermissions(context, definition.moduleKey, [...definition.viewPermissions, ...documents.view]);
}

/** The self-service door: somebody's own record, reached without a grant over anybody else. */
async function selfDoorOpen(context: UserContext, definition: RecordDefinition, id: string): Promise<boolean> {
  const self = definition.documents?.self;
  if (!self || !self.isSelf(context, id) || !can(context, self.permission)) return false;
  const access = context.moduleAccess[definition.moduleKey];
  if (!access?.enabled) return false;
  if (definition.type === "employee") {
    const profile = await prisma.employeeProfile.findFirst({
      where: { companyId: context.companyId, companyMemberId: id },
      select: { id: true },
    });
    return Boolean(profile);
  }
  return false;
}

/**
 * A project or client parent as this caller may read its files: the record's
 * own view permission, its document grant, and the record inside the reader's
 * scope — the same gate its documents tab applies (PRD #47 §81).
 */
async function readableContainer(
  context: UserContext,
  parent: Extract<DocumentParentKind, { kind: "project" | "client" }>,
): Promise<RecordSummary | null> {
  const definition = recordDefinition(parent.kind);
  if (!definition || !recordDocumentReadHeld(context, definition)) return null;
  return definition.find(context, parent.kind === "project" ? parent.projectId : parent.clientId);
}

/**
 * Can this caller reach the record a document hangs off?
 *
 * Company isolation is applied by the caller (every document query carries the
 * company), then the filing module, then the parent itself.
 */
export async function canReachDocumentParent(
  context: UserContext,
  ref: DocumentParentRef,
): Promise<boolean> {
  const parent = classifyDocumentParent(ref);
  if (!filingModuleAllowed(context, ref, parent)) return false;

  switch (parent.kind) {
    case "project":
    case "client":
      return (await readableContainer(context, parent)) !== null;
    case "record": {
      if (await selfDoorOpen(context, parent.definition, parent.id)) return true;
      if (!recordDocumentReadHeld(context, parent.definition)) return false;
      return (await parent.definition.find(context, parent.id)) !== null;
    }
    case "company":
      if (parent.module === null) return can(context, "document.company.view");
      // Company-level reach of the filing module, and its document grant.
      return isModuleKey(parent.module) && companyLevelModules(context).includes(parent.module);
    case "unregistered":
      return false;
  }
}

/** The parent record as this caller sees it, or null — for labels and return routes. */
export async function loadDocumentParentRecord(
  context: UserContext,
  ref: DocumentParentRef,
): Promise<RecordSummary | null> {
  const parent = classifyDocumentParent(ref);
  if (parent.kind === "project" || parent.kind === "client") {
    return filingModuleAllowed(context, ref, parent) ? readableContainer(context, parent) : null;
  }
  if (parent.kind === "record") {
    if (!(await canReachDocumentParent(context, ref))) return null;
    // The self door reads the record without the reader's HR grant, so the
    // summary is built from the definition's own lookup only when that holds.
    return (await parent.definition.find(context, parent.id)) ?? selfSummary(context, parent);
  }
  return null;
}

async function selfSummary(
  context: UserContext,
  parent: Extract<DocumentParentKind, { kind: "record" }>,
): Promise<RecordSummary | null> {
  if (parent.type !== "employee") return null;
  return {
    type: "employee",
    id: parent.id,
    companyId: context.companyId,
    label: context.fullName,
    href: `/hr/employees/${parent.id}`,
    projectId: null,
    archived: false,
    stakeholderMemberIds: [],
  };
}

/** May this caller file a *new* document against that parent (PRD #13 §43, §91, PRD #38 §55)? */
export async function canAttachToDocumentParent(
  context: UserContext,
  ref: DocumentParentRef,
): Promise<boolean> {
  if (!can(context, "document.create")) return false;

  const parent = classifyDocumentParent(ref);
  switch (parent.kind) {
    case "company":
      // A general company document needs the company-document grant on top
      // (PRD #13 §92).
      return parent.module === null && can(context, "document.company.create");
    case "unregistered":
      return false;
    case "record": {
      const upload = parent.definition.documents?.upload;
      // A record type that takes no uploads takes none, whoever is asking.
      if (upload === null || upload === undefined) return false;
      if (!upload.every((permission) => can(context, permission))) return false;
      if (!recordDocumentReadHeld(context, parent.definition)) return false;
      const record = await parent.definition.find(context, parent.id);
      return record !== null && !record.archived && !record.filesClosed;
    }
    case "project":
    case "client": {
      // An archived project or client keeps its files readable but takes no
      // new ones, the same rule a record parent follows (PRD #47 §85).
      if (!filingModuleAllowed(context, ref, parent)) return false;
      const record = await readableContainer(context, parent);
      return record !== null && !record.archived;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Readable document                                                           */
/* -------------------------------------------------------------------------- */

const READABLE_SELECT = {
  id: true,
  companyId: true,
  name: true,
  status: true,
  storageStatus: true,
  projectId: true,
  clientId: true,
  module: true,
  entityType: true,
  entityId: true,
  uploadedByMemberId: true,
} satisfies Prisma.DocumentSelect;

export type ReadableDocument = Prisma.DocumentGetPayload<{ select: typeof READABLE_SELECT }>;

/**
 * A document this caller may read right now, or null. Another company's id, an
 * unreachable parent and a missing row all answer the same way.
 */
export async function findReadableDocument(context: UserContext, documentId: string): Promise<ReadableDocument | null> {
  if (!moduleAndPermissions(context, "documents", ["document.view"])) return null;
  const document = await prisma.document.findFirst({
    where: { id: documentId, companyId: context.companyId },
    select: READABLE_SELECT,
  });
  if (!document) return null;
  return (await canReachDocumentParent(context, document)) ? document : null;
}

/* -------------------------------------------------------------------------- */
/* List query                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The authorised `where` for a document list (PRD #13 §134, §135, PRD #38 §66).
 *
 * Built as OR branches rather than by loading every document and filtering in
 * memory. Record branches are exact: for each record type the reader holds the
 * permissions for, the records that actually carry documents are narrowed by
 * that type's own scope in one query, and only those ids enter the clause — so
 * an opportunity brief on somebody else's opportunity stays out of the list,
 * the search results and the counts, not merely off the detail page.
 */
export async function buildDocumentAccessWhere(context: UserContext): Promise<Prisma.DocumentWhereInput> {
  const reachable = reachableModules(context);
  const readableModules = documentModules(context);
  const companyLevel = companyLevelModules(context);

  // The list-clause form of `filingModuleAllowed`: a module label needs that
  // module's document grant, unless it is the record's own module, which the
  // record's definition already governed when it let the type in.
  const moduleGate = (ownModule?: ModuleKey): Prisma.DocumentWhereInput => ({
    OR: [
      { module: null },
      { module: { in: readableModules } },
      ...(ownModule && reachable.includes(ownModule) ? [{ module: ownModule }] : []),
    ],
  });

  const notARecord: Prisma.DocumentWhereInput = {
    OR: [{ entityType: null }, { entityType: { in: ["project", "client"] } }],
  };

  const branches: Prisma.DocumentWhereInput[] = [];

  const projectDefinition = recordDefinition("project");
  if (projectDefinition && recordDocumentReadHeld(context, projectDefinition)) {
    branches.push({
      AND: [notARecord, { projectId: { not: null } }, { project: buildProjectScopeWhere(context) }, moduleGate()],
    });
  }

  const clientDefinition = recordDefinition("client");
  if (clientDefinition && recordDocumentReadHeld(context, clientDefinition)) {
    branches.push({
      AND: [notARecord, { projectId: null, clientId: { not: null } }, { client: buildClientScopeWhere(context) }, moduleGate()],
    });
  }

  const recordDefinitionsWithDocuments = recordDefinitions().filter(
    (definition) => definition.documents && definition.type !== "project" && definition.type !== "client",
  );
  const readableTypes = recordDefinitionsWithDocuments.filter((definition) => recordDocumentReadHeld(context, definition));

  if (readableTypes.length > 0) {
    const candidates = await prisma.document.groupBy({
      by: ["entityType", "entityId"],
      where: {
        companyId: context.companyId,
        entityType: { in: readableTypes.map((definition) => definition.type) },
        entityId: { not: null },
      },
    });

    const idsByType = new Map<string, string[]>();
    for (const row of candidates) {
      if (!row.entityType || !row.entityId) continue;
      idsByType.set(row.entityType, [...(idsByType.get(row.entityType) ?? []), row.entityId]);
    }

    const reachableByType = await Promise.all(
      readableTypes.map(async (definition) => ({
        definition,
        ids: await definition.reachable(context, idsByType.get(definition.type) ?? []),
      })),
    );

    for (const { definition, ids } of reachableByType) {
      if (ids.length === 0) continue;
      branches.push({ AND: [{ entityType: definition.type, entityId: { in: ids } }, moduleGate(definition.moduleKey)] });
    }
  }

  // Self-service: a record whose id is the reader's own membership, reached
  // without any grant over anybody else (PRD #16 §135).
  for (const definition of recordDefinitionsWithDocuments) {
    const self = definition.documents?.self;
    if (!self || !can(context, self.permission) || !self.isSelf(context, context.membershipId)) continue;
    if (!context.moduleAccess[definition.moduleKey]?.enabled) continue;
    branches.push({ AND: [{ entityType: definition.type, entityId: context.membershipId }, moduleGate(definition.moduleKey)] });
  }

  // A company document needs company-level access to its filing module and
  // that module's document grant, or the dedicated company-document grant when
  // it has no module at all.
  if (can(context, "document.company.view")) {
    branches.push({ projectId: null, clientId: null, entityType: null, module: null });
  }
  if (companyLevel.length > 0) {
    branches.push({ AND: [{ projectId: null, clientId: null, entityType: null }, { module: { in: companyLevel } }] });
  }

  // No branch at all is a real answer — nothing — not an unfiltered query.
  return { companyId: context.companyId, OR: branches.length > 0 ? branches : [{ id: { in: [] } }] };
}

/* -------------------------------------------------------------------------- */
/* Parent resolution                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Just the fields that name a parent.
 *
 * Narrower than either input schema on purpose: both the metadata form and the
 * upload request satisfy it, so neither has to be cast to the other's shape to
 * ask the same question.
 */
export type DocumentParentInput = {
  context: CreateDocumentInput["context"];
  projectId?: string;
  clientId?: string;
  entityType?: string;
  entityId?: string;
};

/**
 * Turns a create request into a parent reference, validating the record it
 * names belongs to this company.
 *
 * The context chosen in the form is not trusted: a project id from another
 * company, or one this caller cannot open, is refused here rather than being
 * written and hidden later (PRD #13 §91, §236).
 */
export async function resolveDocumentParent(
  context: UserContext,
  input: DocumentParentInput,
): Promise<DocumentParentRef> {
  if (input.context === "project") {
    // Looked up inside the caller's own scope, so a project they cannot reach
    // reads as "does not exist" rather than being confirmed to them.
    const project = await loadRecord(context, "project", input.projectId ?? "");
    if (!project) throw new AccessError("VALIDATION_ERROR", "That project does not exist.");
    return { projectId: project.id, clientId: null, module: "projects", entityType: "project", entityId: project.id };
  }

  if (input.context === "client") {
    const client = await loadRecord(context, "client", input.clientId ?? "");
    if (!client) throw new AccessError("VALIDATION_ERROR", "That client does not exist.");
    return { projectId: null, clientId: client.id, module: "clients", entityType: "client", entityId: client.id };
  }

  if (input.context === "record") {
    const definition = input.entityType ? recordDefinition(input.entityType) : null;
    if (!definition?.documents || definition.type === "project" || definition.type === "client" || !input.entityId) {
      throw new AccessError("VALIDATION_ERROR", "That record does not take documents.");
    }
    /*
     * The record is not looked up here: `canAttachToDocumentParent` reads it
     * through its registry definition, inside the caller's scope. One place
     * decides reachability.
     */
    return {
      projectId: null,
      clientId: null,
      module: definition.moduleKey,
      entityType: definition.type,
      entityId: input.entityId,
    };
  }

  return { projectId: null, clientId: null, module: null, entityType: null, entityId: null };
}

/** Record types a file can be uploaded against from a record page. */
export function uploadableRecordTypes(): RecordType[] {
  return recordDefinitions()
    .filter((definition) => definition.documents?.upload != null && definition.type !== "project" && definition.type !== "client")
    .map((definition) => definition.type);
}

/**
 * Where a record's files are listed — the return route after an upload or a
 * cancel (PRD #38 §49, §55). Null for anything the caller cannot reach.
 */
export async function documentReturnRoute(context: UserContext, ref: DocumentParentRef): Promise<string | null> {
  const parent = classifyDocumentParent(ref);
  const record = await loadDocumentParentRecord(context, ref);
  if (!record) return null;
  if (parent.kind === "project") return `/projects/${record.id}/documents`;
  if (parent.kind === "client") return `/clients/${record.id}/documents`;
  if (parent.kind === "record") return parent.definition.documents?.tabHref(record) ?? null;
  return null;
}
