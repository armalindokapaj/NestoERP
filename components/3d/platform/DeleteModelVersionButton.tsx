"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { engineeringApi, failureMessage } from "@/components/engineering/engineering-api";
import Link from "@/components/navigation/nav-link";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useTranslations } from "@/components/i18n/i18n-provider";
import type { Translate } from "@/lib/i18n/translator";
import type { Project3DModelUsage } from "@/lib/modules/project-3d/project-3d.model-library";

type State =
  | { step: "closed" }
  | { step: "checking" }
  | { step: "ready"; usage: Project3DModelUsage }
  | { step: "failed"; message: string };

/**
 * Permanent delete from the Model Library (Experience Editor no-reason PRD
 * §13-§15, §19). A strong confirmation — never a typed reason — after reading
 * what still uses the version. Anything that would break blocks the delete and
 * points at the place to resolve it; the server re-checks on delete.
 */
export function DeleteModelVersionButton({ versionId, fileName }: { versionId: string; fileName: string }) {
  const [state, setState] = React.useState<State>({ step: "closed" });
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();
  const t = useTranslations("adminPlatform");

  async function open() {
    setError(null);
    setState({ step: "checking" });
    try {
      const usage = await engineeringApi<Project3DModelUsage>(`/api/platform/3d/models/${versionId}/usage`);
      setState({ step: "ready", usage });
    } catch (failure) {
      setState({ step: "failed", message: failureMessage(failure, t("threeDAdmin.deleteVersion.checkFailed")) });
    }
  }

  async function remove() {
    setPending(true);
    setError(null);
    try {
      await engineeringApi(`/api/platform/3d/models/${versionId}`, { method: "DELETE", body: { confirmPermanentDelete: true } });
      setState({ step: "closed" });
      toast({ title: t("threeDAdmin.deleteVersion.deleted", { name: fileName }), tone: "success" });
      router.refresh();
    } catch (failure) {
      setError(failureMessage(failure, t("threeDAdmin.deleteVersion.deleteFailed")));
    } finally {
      setPending(false);
    }
  }

  const close = (next: boolean) => { if (!next && !pending) setState({ step: "closed" }); };
  const usage = state.step === "ready" ? state.usage : null;
  const blocked = usage !== null && usage.blockers.length > 0;

  return (
    <>
      <Button type="button" size="sm" variant="ghost" className="text-danger-strong" onClick={() => void open()} disabled={state.step === "checking"} aria-label={t("threeDAdmin.deleteVersion.deleteAria", { name: fileName })}>
        <Trash2 aria-hidden="true" />{state.step === "checking" ? t("threeDAdmin.deleteVersion.checking") : t("threeDAdmin.deleteVersion.delete")}
      </Button>

      <ConfirmDialog
        open={usage !== null && !blocked}
        onOpenChange={close}
        title={t("threeDAdmin.deleteVersion.confirmTitle", { name: fileName })}
        description={t("threeDAdmin.deleteVersion.confirmDescription")}
        confirmLabel={t("threeDAdmin.deleteVersion.confirmLabel")}
        pending={pending}
        onConfirm={() => void remove()}
      >
        {usage ? (
          <ul className="list-disc space-y-1 pl-5 text-table text-fg-muted">
            <li>{t("threeDAdmin.deleteVersion.usage", { model: usage.model.name, version: usage.version, experience: usage.experience.name })}</li>
            <li>{usage.bindingCount === 0 ? t("threeDAdmin.deleteVersion.noLinks") : t("threeDAdmin.deleteVersion.links", { count: usage.bindingCount })}</li>
            <li>{t("threeDAdmin.deleteVersion.notReleased")}</li>
          </ul>
        ) : null}
        {error ? <p role="alert" className="text-table text-danger-strong">{error}</p> : null}
      </ConfirmDialog>

      <Dialog open={blocked || state.step === "failed"} onOpenChange={close}>
        <DialogContent className="max-w-md">
          <DialogTitle>{state.step === "failed" ? t("threeDAdmin.deleteVersion.failedTitle") : t("threeDAdmin.deleteVersion.inUseTitle", { name: fileName })}</DialogTitle>
          <DialogDescription>{state.step === "failed" ? state.message : blockedExplanation(usage!, t)}</DialogDescription>
          <DialogFooter>
            <DialogClose asChild><Button variant="secondary">{t("threeDAdmin.deleteVersion.cancel")}</Button></DialogClose>
            {usage?.blockers.includes("RELEASED") ? (
              <Button asChild variant="secondary"><Link href={`/admin/3d/projects/${usage.experience.projectId}/releases`}>{t("threeDAdmin.deleteVersion.viewUsages")}</Link></Button>
            ) : null}
            {usage?.blockers.includes("SHOWN_IN_EXPERIENCE") ? (
              <Button asChild><Link href={`/admin/3d/projects/${usage.experience.projectId}/models`}>{t("threeDAdmin.deleteVersion.removeFromExperience")}</Link></Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function blockedExplanation(usage: Project3DModelUsage, t: Translate<"adminPlatform">): string {
  const reasons: string[] = [];
  if (usage.blockers.includes("RELEASED")) {
    reasons.push(usage.releases.length
      ? t("threeDAdmin.deleteVersion.releasedNamed", { releases: usage.releases.join(", ") })
      : t("threeDAdmin.deleteVersion.released"));
  }
  if (usage.blockers.includes("SHOWN_IN_EXPERIENCE")) reasons.push(t("threeDAdmin.deleteVersion.shown", { name: usage.experience.name }));
  if (usage.blockers.includes("IN_PROGRESS")) reasons.push(t("threeDAdmin.deleteVersion.inProgress"));
  return `${reasons.join(" ")} ${t("threeDAdmin.deleteVersion.nothingDeleted")}`;
}
