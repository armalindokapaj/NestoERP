"use client";

import * as React from "react";
import { Loader2, Paperclip, Trash2 } from "@/components/icons";

import { uploadErrorText, useDocumentsTranslations } from "@/components/documents/documents-text";
import { UPLOAD_IN_FLIGHT, useUploadQueue } from "@/components/documents/upload-queue";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { useRouter } from "@/components/navigation/guarded-router";
import { failureMessage, structureApi } from "@/components/project-structure/structure-ui";
import { FileLine } from "@/components/project-structure/unit-page/unit-documents";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import type { UnitDocumentLinkDTO, UnitFilesDTO } from "@/lib/modules/project-structure/unit-publishing.types";

/**
 * The buyer's signed contract, on a unit's sales page (/sales/units).
 *
 * Whoever sells the unit uploads it: a canonical Document with the unit as its
 * parent, filed as Contract (unit-documents.rules.ts). Legal reads it with the
 * unit's documents. Removing one takes it off the unit; the file stays where
 * it is, as every unit document's does.
 */
export function SaleContract({ unitId, unitCode, files }: { unitId: string; unitCode: string; files: UnitFilesDTO }) {
  const t = useTranslations("projects");
  const tDocuments = useDocumentsTranslations();
  const router = useRouter();
  const toast = useToast();
  const input = React.useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = React.useState<UnitDocumentLinkDTO | null>(null);
  const [pending, setPending] = React.useState(false);
  const contracts = files.documents.filter((link) => link.category === "CONTRACT");
  const canChange = files.capabilities.canManageContract;

  const queue = useUploadQueue({
    parent: { context: "record", entityType: "project_unit", entityId: unitId },
    onUploaded: (documentId) => {
      void structureApi(`/api/project-units/${unitId}/documents`, { body: { documentId, category: "CONTRACT" } })
        .then(() => toast({ title: t("salesUnit.contractAdded", { code: unitCode }) }))
        .catch((error) => toast({ title: failureMessage(error, t("unitFiles.attachFailed")), tone: "danger" }))
        .finally(() => router.refresh());
    },
  });
  const uploading = queue.items.filter((item) => UPLOAD_IN_FLIGHT.includes(item.status)).length;

  React.useEffect(() => {
    const failed = queue.items.find((item) => item.status === "failed" && item.error);
    if (failed) toast({ title: uploadErrorText(tDocuments, failed.error ?? t("unitFiles.uploadFailed")), tone: "danger" });
    // Report each failure once, as it happens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.items.filter((item) => item.status === "failed").length]);

  async function remove() {
    if (!removing) return;
    setPending(true);
    try {
      await structureApi(`/api/project-units/${unitId}/documents/${removing.id}`, { method: "DELETE" });
      setRemoving(null);
      router.refresh();
    } catch (error) {
      toast({ title: failureMessage(error, t("unitFiles.removeFailed")), tone: "danger" });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="nesto-card p-5" aria-labelledby="sale-contract-heading" data-testid="sale-contract">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="sale-contract-heading" className="text-card font-semibold text-fg">
            {t("salesUnit.contractTitle")}
          </h2>
          <p className="mt-1 text-meta text-fg-muted">{t("salesUnit.contractBody")}</p>
        </div>
        {canChange && files.capabilities.canUpload ? (
          <div className="flex items-center gap-2">
            {uploading ? (
              <span className="inline-flex items-center gap-1.5 text-meta text-fg-muted" aria-live="polite">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> {t("unitFiles.uploading", { what: uploading })}
              </span>
            ) : null}
            <Button size="sm" onClick={() => input.current?.click()} disabled={uploading > 0} data-testid="sale-contract-upload">
              <Paperclip aria-hidden="true" />
              {t("salesUnit.uploadContract")}
            </Button>
            <input
              ref={input}
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              multiple
              hidden
              onChange={(event) => {
                const chosen = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (chosen.length) queue.enqueue(chosen, (file) => ({ name: file.name.replace(/\.[^.]+$/, "") }));
              }}
            />
          </div>
        ) : null}
      </div>
      {contracts.length === 0 ? (
        <p className="mt-4 text-table text-fg-muted">{t("salesUnit.noContract")}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line" data-testid="sale-contract-list">
          {contracts.map((link) => (
            <li key={link.id} className="flex items-center justify-between gap-2 py-2.5 text-table">
              <FileLine file={link.document} />
              {canChange ? (
                <Button variant="ghost" size="icon" aria-label={t("unitFiles.removeFrom", { name: link.document.name, code: unitCode })} onClick={() => setRemoving(link)}>
                  <Trash2 />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(value) => !value && setRemoving(null)}
        title={t("unitFiles.removeTitle", { code: unitCode })}
        description={t("unitFiles.removeBody")}
        confirmLabel={t("unitFiles.remove")}
        pending={pending}
        onConfirm={() => void remove()}
      />
    </section>
  );
}
