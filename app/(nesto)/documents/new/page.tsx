import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DocumentUploader } from "@/components/documents/document-uploader";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { maxUploadMegabytes } from "@/lib/modules/documents/document.files";
import { documentFormOptions } from "@/lib/modules/documents/document.options";
import {
  canAttachToDocumentParent,
  documentReturnRoute,
  loadDocumentParentRecord,
  type DocumentParentRef,
} from "@/lib/modules/documents/document.parent-access";
import { recordDefinition } from "@/lib/core/records/record.registry";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("documents");
  return { title: t("meta.addDocument") };
}

/**
 * Upload a document (PRD #13 §86–§92).
 *
 * `?projectId=` / `?clientId=` lock the context when the form is opened from a
 * record page. The service revalidates the parent against the caller's scope,
 * so a hand-edited parameter cannot file against a record they cannot see
 * (PRD #13 §91, §236).
 */
export default async function NewDocumentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule("documents");
  if (!can(context, "document.create")) notFound();

  const params = await searchParams;
  const t = await getTranslations("documents");
  const options = await documentFormOptions(context);

  const requestedProjectId = typeof params.projectId === "string" ? params.projectId : "";
  const requestedClientId = typeof params.clientId === "string" ? params.clientId : "";
  const requestedEntityType = typeof params.entityType === "string" ? params.entityType : "";
  const requestedEntityId = typeof params.entityId === "string" ? params.entityId : "";

  // Only a parent the picker itself can list is locked in, so the preselection
  // can never disagree with what the service will accept.
  const project = options.projects.find((option) => option.value === requestedProjectId);
  const client = options.clients.find((option) => option.value === requestedClientId);

  /*
   * A record parent comes from the record registry — the same entry the upload
   * service authorises against — so the form never offers a record the service
   * would refuse, and a record page that links here with a type the registry
   * does not accept gets no form at all rather than an unlocked one that fails
   * on submit (PRD #38 §55).
   */
  const record = await resolveRecordContext(context, requestedEntityType, requestedEntityId);
  if (requestedEntityType && requestedEntityId && !record) notFound();

  const lockedContext = project
    ? { kind: "project" as const, id: project.value, label: project.label }
    : client
      ? { kind: "client" as const, id: client.value, label: client.label }
      : record;

  const returnHref = record?.returnHref ?? cancelHref(lockedContext);

  // Nothing to file against and no company grant: the page would be a dead end.
  if (!lockedContext && options.projects.length === 0 && options.clients.length === 0 && !options.canFileToCompany) {
    notFound();
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[{ label: t("crumbs.documents"), href: "/documents" }, { label: t("crumbs.addDocument") }]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("newPage.title")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">{t("newPage.intro")}</p>
      </div>

      <DocumentUploader
        projects={options.projects}
        clients={options.clients}
        canFileToCompany={options.canFileToCompany}
        lockedContext={lockedContext}
        maxMegabytes={maxUploadMegabytes()}
        cancelHref={returnHref}
        doneHref={returnHref}
      />
    </div>
  );
}

function cancelHref(locked?: { kind: "project" | "client" | "record"; id: string }): string {
  if (locked?.kind === "project") return `/projects/${locked.id}/documents`;
  if (locked?.kind === "client") return `/clients/${locked.id}/documents`;
  return "/documents/all";
}

/**
 * The record a document is being filed against, labelled the way a person
 * recognises it, with the route its files are listed under. Undefined when the
 * type takes no uploads or this caller may not add one to that record.
 */
async function resolveRecordContext(
  context: Awaited<ReturnType<typeof requireModule>>,
  entityType: string,
  entityId: string,
) {
  if (!entityType || !entityId) return undefined;
  const definition = recordDefinition(entityType);
  if (!definition?.documents) return undefined;

  const ref: DocumentParentRef = {
    projectId: null,
    clientId: null,
    module: definition.moduleKey,
    entityType: definition.type,
    entityId,
  };

  if (!(await canAttachToDocumentParent(context, ref))) return undefined;
  const summary = await loadDocumentParentRecord(context, ref);
  const returnHref = await documentReturnRoute(context, ref);
  if (!summary || !returnHref) return undefined;

  return {
    kind: "record" as const,
    id: entityId,
    label: `${definition.noun} · ${summary.label}`,
    entityType: definition.type,
    returnHref,
  };
}
