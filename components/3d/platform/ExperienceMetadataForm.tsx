"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { engineeringApi, failureMessage } from "@/components/engineering/engineering-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useTranslations } from "@/components/i18n/i18n-provider";

export function ExperienceMetadataForm({ projectId, name, notes }: { projectId: string; name: string; notes: string | null }) {
  const [experienceName, setExperienceName] = React.useState(name);
  const [internalNotes, setInternalNotes] = React.useState(notes ?? "");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();
  const t = useTranslations("adminPlatform");

  async function save() {
    setPending(true); setError(null);
    try {
      await engineeringApi(`/api/platform/3d/experiences/${projectId}`, { method: "PATCH", body: { experienceName, internalNotes: internalNotes.trim() || null } });
      toast({ title: t("threeDAdmin.metadata.saved"), tone: "success" });
      router.refresh();
    } catch (failure) { setError(failureMessage(failure, t("threeDAdmin.metadata.saveFailed"))); }
    finally { setPending(false); }
  }

  return <section className="nesto-card p-5"><h2 className="text-card font-semibold text-fg">{t("threeDAdmin.metadata.title")}</h2><p className="mt-1 text-table text-fg-muted">{t("threeDAdmin.metadata.description")}</p><div className="mt-4 grid gap-4 lg:grid-cols-2"><label className="text-meta font-medium text-fg-muted">{t("threeDAdmin.metadata.name")}<Input className="mt-1.5" value={experienceName} onChange={(event) => setExperienceName(event.target.value)} maxLength={160} /></label><label className="text-meta font-medium text-fg-muted lg:col-span-2">{t("threeDAdmin.metadata.notes")}<Textarea className="mt-1.5" value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} maxLength={2000} /></label></div><div className="mt-4 flex items-center justify-between gap-3">{error ? <p role="alert" className="text-table text-danger-strong">{error}</p> : <span />}<Button type="button" onClick={() => void save()} disabled={pending || experienceName.trim().length < 2}>{pending ? t("threeDAdmin.metadata.saving") : t("threeDAdmin.metadata.save")}</Button></div></section>;
}
