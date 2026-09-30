"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ExternalLink, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AccessError, resolveAccess, type ResolvedAccess } from "@/lib/field/document-service";
import { useDocumentsTranslations } from "../documents-text";
import { ImageViewer } from "./image-viewer";
import { PdfViewer } from "./pdf-viewer";

/**
 * DocumentViewer (MOB-07 §15-§18, §23, §72): the full-screen viewer for a PDF or
 * a photo, or a set of photos to swipe through.
 *
 * It covers the bottom navigation and Project tabs for as long as it is open
 * and keeps one clear Close control at the top (§18). Each item is resolved
 * through `resolveAccess` when it becomes the current one, so the grant is made
 * with the reader's permissions at that moment and an item nobody looks at is
 * never requested.
 */

export type ViewerItem = { documentId: string; name: string; note?: string | null };

export function DocumentViewer({
  open,
  onOpenChange,
  items,
  index = 0,
  onIndexChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ViewerItem[];
  index?: number;
  onIndexChange?: (index: number) => void;
}) {
  const t = useDocumentsTranslations();
  const item = items[index];
  const [access, setAccess] = React.useState<ResolvedAccess | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  const documentId = item?.documentId;
  React.useEffect(() => {
    if (!open || !documentId) return;
    let cancelled = false;
    setAccess(null);
    setError(null);
    resolveAccess(documentId, "preview").then(
      (value) => !cancelled && setAccess(value),
      (failure) => !cancelled && setError(failure instanceof AccessError ? failure.message : t("viewer.accessError")),
    );
    return () => {
      cancelled = true;
    };
  }, [open, documentId, attempt, t]);

  if (!item) return null;
  const many = items.length > 1;
  const go = (next: number) => onIndexChange?.((next + items.length) % items.length);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          className="fixed inset-0 z-[80] flex flex-col bg-surface text-fg outline-none"
          data-testid="document-viewer"
          aria-describedby={undefined}
        >
          <header className="flex items-center gap-2 border-b border-line bg-surface px-2 pt-[max(0.25rem,env(safe-area-inset-top))] pb-1">
            <DialogPrimitive.Close asChild>
              <Button type="button" variant="ghost" size="icon" aria-label={t("viewer.close")} data-testid="document-viewer-close">
                <X aria-hidden="true" />
              </Button>
            </DialogPrimitive.Close>
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-table font-medium">{item.name}</DialogPrimitive.Title>
            {access ? (
              <Button asChild variant="ghost" size="icon">
                <a href={access.url} target="_blank" rel="noopener noreferrer" aria-label={t("viewer.openExternal")}>
                  <ExternalLink aria-hidden="true" />
                </a>
              </Button>
            ) : null}
          </header>

          <div className="min-h-0 flex-1">
            {error ? (
              <div role="alert" className="m-4 space-y-3 rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
                <p>{error}</p>
                <Button type="button" size="sm" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
                  {t("viewer.view")}
                </Button>
              </div>
            ) : !access ? (
              <div className="flex h-full items-center justify-center gap-2 text-table text-fg-muted" role="status">
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                {t("viewer.loading")}
              </div>
            ) : access.kind === "pdf" ? (
              <PdfViewer
                url={access.url}
                labels={{
                  loading: t("viewer.loading"),
                  error: t("viewer.pdfError"),
                  page: (current, total) => t("viewer.page", { current, total }),
                  previous: t("viewer.previousPage"),
                  next: t("viewer.nextPage"),
                  zoomIn: t("viewer.zoomIn"),
                  zoomOut: t("viewer.zoomOut"),
                  fitWidth: t("viewer.fitWidth"),
                  pageLabel: (n) => t("viewer.pageLabel", { n }),
                }}
              />
            ) : access.kind === "image" ? (
              <ImageViewer
                src={access.url}
                alt={item.name}
                position={many ? { index, total: items.length } : undefined}
                onPrevious={many ? () => go(index - 1) : undefined}
                onNext={many ? () => go(index + 1) : undefined}
                labels={{
                  zoomIn: t("viewer.zoomIn"),
                  zoomOut: t("viewer.zoomOut"),
                  previous: t("viewer.previousImage"),
                  next: t("viewer.nextImage"),
                  position: (current, total) => t("viewer.imageOf", { index: current, total }),
                  failed: t("viewer.imageFailed"),
                }}
              />
            ) : (
              <p className="m-4 text-table text-fg-muted">{t("viewer.accessError")}</p>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** A button that opens one document in the viewer. */
export function ViewDocumentButton({ documentId, name, className }: { documentId: string; name: string; className?: string }) {
  const t = useDocumentsTranslations();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="secondary" className={className} onClick={() => setOpen(true)} data-testid="view-document">
        {t("viewer.view")}
      </Button>
      {open ? <DocumentViewer open={open} onOpenChange={setOpen} items={[{ documentId, name }]} /> : null}
    </>
  );
}
