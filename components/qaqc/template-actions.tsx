"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { PenLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { templateLifecycleAction } from "@/lib/actions/qaqc";
import type { TemplateDetailDTO } from "@/lib/modules/qaqc/qaqc.types";

/** What a reader may do to a template (PRD #21 §53, §58). */
export function TemplateActions({ template }: { template: TemplateDetailDTO }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [archiving, setArchiving] = React.useState(false);

  const may = template.capabilities;

  function run(action: "archive" | "restore", success: string) {
    startTransition(async () => {
      const result = await templateLifecycleAction(template.id, action);
      if (result.ok) {
        setArchiving(false);
        toast({ title: success, tone: "success" });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  return (
    <>
      {may.canUse ? (
        <Button asChild size="sm">
          <Link href={`/qaqc/inspections/new?templateId=${template.id}`}>Start an inspection</Link>
        </Button>
      ) : null}

      {may.canEdit ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/qaqc/templates/${template.id}/edit`}>
            <PenLine aria-hidden="true" />
            {template.usageCount > 0 ? "New version" : "Edit"}
          </Link>
        </Button>
      ) : null}

      {may.canArchive ? (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setArchiving(true)}>
          Archive
        </Button>
      ) : null}

      {may.canRestore ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => run("restore", "Template restored as inactive.")}
        >
          Restore
        </Button>
      ) : null}

      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={`Archive ${template.code} v${template.version}?`}
        description="It leaves the picker and cannot be used on new inspections. Inspections already run against it keep their checklist exactly as it was. An inspection still in flight blocks this."
        confirmLabel="Archive template"
        pending={pending}
        onConfirm={() => run("archive", "Template archived.")}
      />
    </>
  );
}
