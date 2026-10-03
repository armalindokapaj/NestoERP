"use client";

import * as React from "react";
import { EyeOff } from "lucide-react";

import { engineeringApi, failureMessage } from "@/components/engineering/engineering-api";
import { useRouter } from "@/components/navigation/guarded-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { cn } from "@/lib/utils/cn";

type Audience = "OFFLINE" | "PRIVATE" | "COMPANY_ONLY" | "PUBLIC";

const OPTIONS: Audience[] = ["OFFLINE", "COMPANY_ONLY", "PUBLIC"];

/**
 * Who may open the published experience (Admin Projects & 3D PRD #5 §48-§56):
 * Offline, Company Users or Public (Private is retired). Every change needs a reason and
 * is audited; Public asks for confirmation and sends the exact release and
 * public projection being published, so a newer one cannot slip out
 * unreviewed. Take Offline is always one step away and deletes nothing.
 */
export function PublicationControl({ projectId, visibility, controlVersion, activeRelease, deleted, canManage }: {
  projectId: string;
  visibility: Audience;
  controlVersion: number;
  activeRelease: { id: string; publicManifestHash: string | null } | null;
  deleted: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const t = useTranslations("adminPlatform");
  const audienceLabel = (value: Audience | null) => (value ? t(`threeDAdmin.publication.audiences.${value}.label`) : "");
  const audienceDetail = (value: Audience | null) => (value ? t(`threeDAdmin.publication.audiences.${value}.detail`) : "");
  const [choice, setChoice] = React.useState<Audience>(visibility);
  const [confirm, setConfirm] = React.useState<Audience | null>(null);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  React.useEffect(() => setChoice(visibility), [visibility]);

  async function save(target: Audience) {
    setPending(true);
    setError(null);
    try {
      await engineeringApi(`/api/platform/3d/experiences/${encodeURIComponent(projectId)}/visibility`, {
        method: "PATCH",
        body: {
          visibility: target,
          expectedControlVersion: controlVersion,
          reason,
          ...(target === "PUBLIC" ? { releaseId: activeRelease?.id ?? null, publicManifestHash: activeRelease?.publicManifestHash ?? null } : {}),
        },
      });
      toast({ title: target === "OFFLINE" ? t("threeDAdmin.publication.offlineToast") : t("threeDAdmin.publication.updatedToast"), tone: "success" });
      setConfirm(null);
      setReason("");
      router.refresh();
    } catch (failure) {
      setError(failureMessage(failure, t("threeDAdmin.publication.saveFailed")));
    } finally {
      setPending(false);
    }
  }

  const publicBlocked = !activeRelease ? t("threeDAdmin.publication.publishFirst") : null;

  return (
    <section className="nesto-card p-5" aria-labelledby="publishing-heading" data-testid="publication-control">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="publishing-heading" className="text-card font-semibold text-fg">{t("threeDAdmin.publication.title")}</h2>
          <p className="mt-1 text-table text-fg-muted">{t("threeDAdmin.publication.description")}</p>
        </div>
        {canManage && visibility !== "OFFLINE" && !deleted ? (
          <Button variant="danger" size="sm" onClick={() => setConfirm("OFFLINE")} data-testid="take-offline"><EyeOff aria-hidden="true" />{t("threeDAdmin.publication.takeOffline")}</Button>
        ) : null}
      </div>
      <fieldset className="mt-4 grid gap-2 sm:grid-cols-2" disabled={!canManage || deleted || pending}>
        <legend className="sr-only">{t("threeDAdmin.publication.audience")}</legend>
        {/* Private is no longer offered; an experience still on it shows it until changed. */}
        {[...OPTIONS, ...(visibility === "PRIVATE" ? ["PRIVATE" as Audience] : [])].map((option) => {
          const blocked = option === "PUBLIC" && publicBlocked;
          return (
            <label key={option} className={cn("flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors", choice === option ? "border-accent bg-accent-soft/50" : "border-line hover:bg-hover/50", blocked && "cursor-not-allowed opacity-60")}>
              <input type="radio" name="audience" value={option} checked={choice === option} disabled={Boolean(blocked)} onChange={() => setChoice(option)} className="mt-1" />
              <span>
                <span className="block text-body font-medium text-fg">{audienceLabel(option)}{visibility === option ? <span className="ml-2 text-meta font-normal text-fg-subtle">{t("threeDAdmin.publication.current")}</span> : null}</span>
                <span className="block text-meta text-fg-muted">{blocked || audienceDetail(option)}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {canManage && choice !== visibility ? (
        <div className="mt-3 flex justify-end"><Button size="sm" onClick={() => setConfirm(choice)} data-testid="publication-save">{t("threeDAdmin.publication.save")}</Button></div>
      ) : null}
      {deleted ? <p className="mt-3 text-table text-fg-muted">{t("threeDAdmin.publication.deleted")}</p> : null}

      <Dialog open={confirm !== null} onOpenChange={(open) => { if (!open && !pending) { setConfirm(null); setError(null); } }}>
        <DialogContent className="max-w-md">
          <DialogTitle>{confirm === "PUBLIC" ? t("threeDAdmin.publication.publicTitle") : confirm === "OFFLINE" ? t("threeDAdmin.publication.offlineTitle") : t("threeDAdmin.publication.changeTitle", { audience: audienceLabel(confirm) })}</DialogTitle>
          <DialogDescription>
            {confirm === "PUBLIC"
              ? t("threeDAdmin.publication.publicDescription")
              : confirm === "OFFLINE"
                ? t("threeDAdmin.publication.offlineDescription")
                : audienceDetail(confirm)}
          </DialogDescription>
          <label className="mt-3 flex flex-col gap-1 text-meta text-fg-subtle">
            {t("threeDAdmin.publication.reason")}
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={500} required className="rounded-md border border-line bg-surface px-2 py-1.5 text-table text-fg" />
          </label>
          {error ? <p role="alert" className="text-table text-danger-strong">{error}</p> : null}
          <DialogFooter>
            <Button variant="secondary" disabled={pending} onClick={() => setConfirm(null)}>{t("threeDAdmin.publication.cancel")}</Button>
            <Button variant={confirm === "OFFLINE" ? "danger" : "primary"} disabled={pending || reason.trim().length < 3} onClick={() => confirm && void save(confirm)}>
              {pending ? t("threeDAdmin.publication.saving") : confirm === "PUBLIC" ? t("threeDAdmin.publication.publishPublicly") : confirm === "OFFLINE" ? t("threeDAdmin.publication.takeOffline") : t("threeDAdmin.publication.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
