"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { engineeringApi, failureMessage } from "@/components/engineering/engineering-api";
import { useRouter } from "@/components/navigation/guarded-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

const field = "h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-table text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

/** Creates a company in the caller's own group, from the group workspace (Admin PRD #9 §28, §91). */
export function CreateGroupCompany({ groupName }: { groupName: string }) {
  const t = useTranslations("group");
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [industry, setIndustry] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await engineeringApi("/api/group/command", { body: { action: "group.company.create", name, ...(industry ? { industry } : {}) } });
      toast({ title: t("companies.created"), tone: "success" });
      setOpen(false);
      setName("");
      setIndustry("");
      router.refresh();
    } catch (failure) {
      setError(failureMessage(failure, t("companies.failed")));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} data-testid="group-create-company">{t("companies.create")}</Button>
      <Dialog open={open} locked={pending} onOpenChange={(next) => { setOpen(next); if (!next) setError(null); }}>
        <DialogContent className="max-w-md" data-testid="group-create-company-dialog">
          <DialogTitle>{t("companies.createTitle", { name: groupName })}</DialogTitle>
          <DialogDescription>{t("companies.createDescription")}</DialogDescription>
          <form onSubmit={submit} className="mt-4 space-y-3">
            <label className="block space-y-1 text-meta text-fg-subtle">{t("companies.name")}<input className={field} value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={120} /></label>
            <label className="block space-y-1 text-meta text-fg-subtle">{t("companies.industry")}<input className={field} value={industry} onChange={(event) => setIndustry(event.target.value)} maxLength={120} /></label>
            {error ? <p role="alert" className="text-table text-danger">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>{t("companies.cancel")}</Button>
              <Button type="submit" disabled={pending}>{t("companies.submit")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
