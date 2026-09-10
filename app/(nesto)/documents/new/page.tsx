import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DocumentUploadForm } from "@/components/documents/document-upload-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { uploadDocumentAction } from "@/lib/actions/documents";
import { maxUploadMegabytes } from "@/lib/modules/documents/document.files";
import { documentFormOptions } from "@/lib/modules/documents/document.options";

export const metadata: Metadata = { title: "Add Document" };

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
  const options = await documentFormOptions(context);

  const requestedProjectId = typeof params.projectId === "string" ? params.projectId : "";
  const requestedClientId = typeof params.clientId === "string" ? params.clientId : "";

  // Only a parent the picker itself can list is locked in, so the preselection
  // can never disagree with what the service will accept.
  const project = options.projects.find((option) => option.value === requestedProjectId);
  const client = options.clients.find((option) => option.value === requestedClientId);

  const lockedContext = project
    ? { kind: "project" as const, id: project.value, label: project.label }
    : client
      ? { kind: "client" as const, id: client.value, label: client.label }
      : undefined;

  // Nothing to file against and no company grant: the page would be a dead end.
  if (!lockedContext && options.projects.length === 0 && options.clients.length === 0 && !options.canFileToCompany) {
    notFound();
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[{ label: "Documents", href: "/documents" }, { label: "Add document" }]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">Add document</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          Files are stored privately and reachable only through the record they belong to.
        </p>
      </div>

      <DocumentUploadForm
        projects={options.projects}
        clients={options.clients}
        canFileToCompany={options.canFileToCompany}
        lockedContext={lockedContext}
        maxMegabytes={maxUploadMegabytes()}
        cancelHref={cancelHref(lockedContext)}
        action={uploadDocumentAction}
      />
    </div>
  );
}

function cancelHref(locked?: { kind: "project" | "client"; id: string }): string {
  if (locked?.kind === "project") return `/projects/${locked.id}/documents`;
  if (locked?.kind === "client") return `/clients/${locked.id}/documents`;
  return "/documents/all";
}
