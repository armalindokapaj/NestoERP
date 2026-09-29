"use client";

import * as React from "react";
import { EyeOff } from "lucide-react";

import { engineeringApi, failureMessage } from "@/components/engineering/engineering-api";
import { useRouter } from "@/components/navigation/guarded-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";

type Audience = "OFFLINE" | "PRIVATE" | "COMPANY_ONLY" | "PUBLIC";

const OPTIONS: Array<{ value: Audience; label: string; detail: string }> = [
  { value: "OFFLINE", label: "Offline", detail: "Nobody outside Platform Admin can open it. Editing and preview still work." },
  { value: "COMPANY_ONLY", label: "Company Users", detail: "Signed-in users of the company, and of its group when it belongs to one, who can see this project." },
  { value: "PUBLIC", label: "Public", detail: "Anyone with the public address, without signing in." },
];

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
      toast({ title: target === "OFFLINE" ? "Experience taken offline." : "Publishing updated.", tone: "success" });
      setConfirm(null);
      setReason("");
      router.refresh();
    } catch (failure) {
      setError(failureMessage(failure, "Publishing was not changed."));
    } finally {
      setPending(false);
    }
  }

  const publicBlocked = !activeRelease ? "Publish a release first." : null;

  return (
    <section className="nesto-card p-5" aria-labelledby="publishing-heading" data-testid="publication-control">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="publishing-heading" className="text-card font-semibold text-fg">Publishing</h2>
          <p className="mt-1 text-table text-fg-muted">Who may open the published experience. Separate from the project&apos;s own status.</p>
        </div>
        {canManage && visibility !== "OFFLINE" && !deleted ? (
          <Button variant="danger" size="sm" onClick={() => setConfirm("OFFLINE")} data-testid="take-offline"><EyeOff aria-hidden="true" />Take Offline</Button>
        ) : null}
      </div>
      <fieldset className="mt-4 grid gap-2 sm:grid-cols-2" disabled={!canManage || deleted || pending}>
        <legend className="sr-only">Audience</legend>
        {/* Private is no longer offered; an experience still on it shows it until changed. */}
        {[...OPTIONS, ...(visibility === "PRIVATE" ? [{ value: "PRIVATE" as const, label: "Private", detail: "Only people assigned to this project. No longer offered; choose another audience." }] : [])].map((option) => {
          const blocked = option.value === "PUBLIC" && publicBlocked;
          return (
            <label key={option.value} className={cn("flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors", choice === option.value ? "border-accent bg-accent-soft/50" : "border-line hover:bg-hover/50", blocked && "cursor-not-allowed opacity-60")}>
              <input type="radio" name="audience" value={option.value} checked={choice === option.value} disabled={Boolean(blocked)} onChange={() => setChoice(option.value)} className="mt-1" />
              <span>
                <span className="block text-body font-medium text-fg">{option.label}{visibility === option.value ? <span className="ml-2 text-meta font-normal text-fg-subtle">current</span> : null}</span>
                <span className="block text-meta text-fg-muted">{blocked || option.detail}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {canManage && choice !== visibility ? (
        <div className="mt-3 flex justify-end"><Button size="sm" onClick={() => setConfirm(choice)} data-testid="publication-save">Save</Button></div>
      ) : null}
      {deleted ? <p className="mt-3 text-table text-fg-muted">This experience is deleted. Restore it before changing who can view it.</p> : null}

      <Dialog open={confirm !== null} onOpenChange={(open) => { if (!open && !pending) { setConfirm(null); setError(null); } }}>
        <DialogContent className="max-w-md">
          <DialogTitle>{confirm === "PUBLIC" ? "Publish this experience publicly?" : confirm === "OFFLINE" ? "Take this experience offline?" : `Change the audience to ${OPTIONS.find((option) => option.value === confirm)?.label}?`}</DialogTitle>
          <DialogDescription>
            {confirm === "PUBLIC"
              ? "Anyone with the public address can open it, without signing in. The public version of the live release is prepared now, which can take a few seconds."
              : confirm === "OFFLINE"
                ? "Viewers lose access at once. The model, configuration, bindings, screenshots and project are kept."
                : OPTIONS.find((option) => option.value === confirm)?.detail}
          </DialogDescription>
          <label className="mt-3 flex flex-col gap-1 text-meta text-fg-subtle">
            Reason
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={500} required className="rounded-md border border-line bg-surface px-2 py-1.5 text-table text-fg" />
          </label>
          {error ? <p role="alert" className="text-table text-danger-strong">{error}</p> : null}
          <DialogFooter>
            <Button variant="secondary" disabled={pending} onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant={confirm === "OFFLINE" ? "danger" : "primary"} disabled={pending || reason.trim().length < 3} onClick={() => confirm && void save(confirm)}>
              {pending ? "Saving…" : confirm === "PUBLIC" ? "Publish Publicly" : confirm === "OFFLINE" ? "Take Offline" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
