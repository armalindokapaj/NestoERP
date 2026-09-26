"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { archiveTemplateAction, restoreTemplateAction } from "@/lib/actions/hse";
import type { TemplateDetailDTO } from "@/lib/modules/hse/hse.types";

/**
 * Retiring and restoring a checklist (PRD #22 §44).
 *
 * Archiving takes it out of circulation for new inspections; it never deletes
 * it, because inspections already run against it still point here.
 */
export function TemplateLifecycle({ template }: { template: TemplateDetailDTO }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [confirm, setConfirm] = React.useState(false);

  const may = template.capabilities;

  function run(work: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        setConfirm(false);
        toast({ title: result.message ?? "Saved.", tone: "success" });
        router.refresh();
      } else {
        toast({ title: result.error ?? "That did not work.", tone: "danger" });
      }
    });
  }

  return (
    <>
      {may.canArchive ? (
        <Button variant="ghost" onClick={() => setConfirm(true)} disabled={pending}>
          Archive
        </Button>
      ) : null}

      {may.canRestore ? (
        <Button
          variant="secondary"
          onClick={() => run(() => restoreTemplateAction(template.id))}
          disabled={pending}
        >
          Restore
        </Button>
      ) : null}

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Archive this checklist"
        description="It stops being offered for new inspections. Inspections already run against it are untouched."
        confirmLabel="Archive"
        onConfirm={() => run(() => archiveTemplateAction(template.id))}
      />
    </>
  );
}
