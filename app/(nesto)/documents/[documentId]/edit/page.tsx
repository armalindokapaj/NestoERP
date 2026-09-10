import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  Field,
  FormSection,
  RecordForm,
} from "@/components/forms/record-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { updateDocumentAction } from "@/lib/actions/documents";
import { documentBreadcrumbs, loadDocument } from "../document-context";

type Params = { params: Promise<{ documentId: string }> };

export const metadata: Metadata = { title: "Edit Document" };

/**
 * Edit document metadata (PRD #13 §106–§109).
 *
 * Name and description only. The stored file is immutable, the storage key does
 * not move when the display name changes, and the parent context is not
 * editable here (PRD #13 §108, §109, §276).
 */
export default async function EditDocumentPage({ params }: Params) {
  const { documentId } = await params;
  const { document } = await loadDocument(documentId);

  if (!document.capabilities.canEdit) notFound();

  async function action(formData: FormData) {
    "use server";
    return updateDocumentAction(documentId, formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs items={documentBreadcrumbs(document, "Edit")} />

      <div>
        <h1 className="text-page font-semibold text-fg">Edit document</h1>
        <p className="mt-1.5 text-body text-fg-muted">{document.name}</p>
      </div>

      <RecordForm
        action={action}
        cancelHref={`/documents/${document.id}`}
        versionUpdatedAt={document.updatedAt}
        submitLabel="Save changes"
        pendingLabel="Saving…"
      >
        <FormSection
          title="Document details"
          description="Renaming a document does not change the stored file."
        >
          <div className="sm:col-span-2">
            <Field label="Document name" name="name" required>
              <Input id="name" name="name" defaultValue={document.name} required maxLength={200} />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field label="Description" name="description">
              <Textarea
                id="description"
                name="description"
                rows={4}
                defaultValue={document.description ?? ""}
                maxLength={2000}
              />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field label="File" name="file">
              <p className="rounded-md border border-line bg-surface-2 px-3 py-2.5 text-body text-fg-muted">
                {document.file.originalFileName ?? "No file name recorded"}
              </p>
            </Field>
          </div>
        </FormSection>
      </RecordForm>
    </div>
  );
}
