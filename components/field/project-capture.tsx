"use client";

import * as React from "react";
import { Camera, ChevronRight } from "lucide-react";

import { useDocumentsTranslations } from "@/components/documents/documents-text";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { EvidenceCapture } from "./evidence-capture";

/**
 * Quick Capture from a Project (MOB-07 §24, §90, §92): one control that opens
 * the field actions for the project the reader is already in. The Project is
 * fixed by the page, never chosen again, and every action is offered only if
 * the server said the reader may do it (`links`, `canUpload` are computed from
 * their permissions in the page, and each destination re-checks them).
 */
export type CaptureLink = { key: string; label: string; href: string };

export function ProjectCapture({ projectId, projectName, canUpload, links }: { projectId: string; projectName: string; canUpload: boolean; links: CaptureLink[] }) {
  const t = useDocumentsTranslations();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  if (!canUpload && links.length === 0) return null;

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)} data-testid="project-capture">
        <Camera aria-hidden="true" />
        {t("capture.capture")}
      </Button>
      <BottomSheet open={open} onOpenChange={setOpen} title={t("capture.captureTitle", { project: projectName })}>
        <div className="space-y-4">
          {links.length ? (
            <ul className="divide-y divide-line rounded-md border border-line">
              {links.map((link) => (
                <li key={link.key}>
                  <Link href={link.href} className="flex min-h-11 items-center justify-between gap-3 px-3 py-2 text-table font-medium text-fg" data-testid={`capture-link-${link.key}`}>
                    {link.label}
                    <ChevronRight aria-hidden="true" className="size-4 text-fg-subtle" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {canUpload ? (
            <div className="space-y-2">
              <p className="text-meta text-fg-muted">{t("capture.captureUploads")}</p>
              <EvidenceCapture
                parent={{ context: "project", projectId }}
                persistKey={`project-capture:${projectId}`}
                onUploaded={() => router.refresh()}
              />
            </div>
          ) : null}
        </div>
      </BottomSheet>
    </>
  );
}
