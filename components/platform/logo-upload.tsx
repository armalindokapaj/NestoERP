"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { engineeringApi, failureMessage } from "@/components/engineering/engineering-api";
import { useRouter } from "@/components/navigation/guarded-router";
import { OrganizationMark } from "@/components/layout/organization-mark";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { LOGO_ACCEPT, LogoError, prepareLogo } from "@/lib/workspace/logo-image";

/**
 * Upload a company's or group's logo straight from the Branding card: pick an
 * image, see it as the sidebar and the 3D viewer will draw it, then save. The
 * browser fits it to a square mark under the storage ceiling, so nothing has to
 * be prepared by hand.
 */
export function LogoUpload({ kind, id, name, logoUrl }: { kind: "company" | "group"; id: string; name: string; logoUrl: string | null }) {
  const t = useTranslations("adminOrgs");
  const router = useRouter();
  const toast = useToast();
  const input = React.useRef<HTMLInputElement>(null);
  const [draft, setDraft] = React.useState<string | null | undefined>(undefined); // undefined: unchanged
  const [note, setNote] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const shown = draft === undefined ? logoUrl : draft;

  async function choose(file: File | undefined) {
    if (!file) return;
    setError(null);
    setNote(null);
    try {
      const prepared = await prepareLogo(file);
      setDraft(prepared.dataUri);
      if (prepared.small) setNote(t("logo.small"));
    } catch (failure) {
      setError(failure instanceof LogoError ? t(`logo.errors.${failure.reason}`) : failureMessage(failure));
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  async function save() {
    if (draft === undefined) return;
    setPending(true);
    setError(null);
    try {
      await engineeringApi("/api/platform-admin/command", {
        body: { action: kind === "company" ? "company.branding" : "group.branding", [kind === "company" ? "companyId" : "groupId"]: id, logoUrl: draft ?? "", reason: draft ? t("logo.reasonSet") : t("logo.reasonRemoved") },
      });
      toast({ title: t(draft ? "logo.saved" : "logo.removed"), tone: "success" });
      setDraft(undefined);
      router.refresh();
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-center gap-4">
        <div className="flex size-24 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-muted">
          {shown ? <img src={shown} alt="" className="size-20 object-contain" /> : <OrganizationMark name={name} logoUrl={null} size="md" />}
        </div>
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap gap-2">
            <input ref={input} type="file" accept={LOGO_ACCEPT} className="sr-only" aria-label={t("logo.choose")} onChange={(event) => void choose(event.target.files?.[0])} />
            <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => input.current?.click()}>{shown ? t("logo.replace") : t("logo.upload")}</Button>
            {shown ? <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => { setDraft(null); setNote(null); }}>{t("logo.remove")}</Button> : null}
            {draft !== undefined ? <Button type="button" size="sm" disabled={pending} onClick={() => void save()}>{pending ? t("logo.saving") : t("logo.save")}</Button> : null}
            {draft !== undefined ? <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => { setDraft(undefined); setNote(null); setError(null); }}>{t("logo.cancel")}</Button> : null}
          </div>
          <p className="text-meta text-fg-muted">{t("logo.guidance")}</p>
          {note ? <p className="text-meta text-warning-strong">{note}</p> : null}
          {error ? <p role="alert" className="text-meta text-danger-strong">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
