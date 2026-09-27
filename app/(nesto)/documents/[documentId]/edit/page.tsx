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
import { getTranslations } from "@/lib/i18n/server";
import { uploadErrorText } from "@/lib/i18n/modules/documents/labels";

type Params = { params: Promise<{ documentId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("documents");
  return { title: t("meta.editDocument") };
}

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
  const t = await getTranslations("documents");

  async function action(formData: FormData) {
    "use server";
    const result = await updateDocumentAction(documentId, formData);
    // The action answers in English; its known refusals read in the reader's language.
    return result.ok ? result : { ...result, error: uploadErrorText(await getTranslations("documents"), result.error) };
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs items={documentBreadcrumbs(document, t("crumbs.documents"), t("crumbs.edit"))} />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("edit.title")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">{document.name}</p>
      </div>

      <RecordForm
        action={action}
        cancelHref={`/documents/${document.id}`}
        versionUpdatedAt={document.updatedAt}
        submitLabel={t("edit.save")}
        pendingLabel={t("edit.saving")}
        module="documents"
      >
        <FormSection
          title={t("edit.section")}
          description={t("edit.sectionHint")}
        >
          <div className="sm:col-span-2">
            <Field label={t("edit.name")} name="name" required>
              <Input id="name" name="name" defaultValue={document.name} required maxLength={200} />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field label={t("edit.description")} name="description">
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
            <Field label={t("edit.file")} name="file">
              <p className="rounded-md border border-line bg-surface-2 px-3 py-2.5 text-body text-fg-muted">
                {document.file.originalFileName ?? t("edit.noFileName")}
              </p>
            </Field>
          </div>
        </FormSection>
      </RecordForm>
    </div>
  );
}
