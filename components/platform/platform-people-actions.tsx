"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, type FormField } from "@/components/engineering/form-kit";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { enumLabel } from "@/lib/i18n/modules/adminAccess/enum-label";

function usePersonFields(): FormField[] {
  const t = useTranslations("adminAccess");
  const lifecycleOptions = ["CANDIDATE", "SELECTED", "EMPLOYEE", "FORMER_EMPLOYEE"].map((value) => ({ value, label: enumLabel(t, "enums.lifecycle", value) }));
  return [
    { name: "firstName", label: t("peopleActions.fields.firstName"), type: "text", required: true },
    { name: "lastName", label: t("peopleActions.fields.lastName"), type: "text", required: true },
    { name: "preferredName", label: t("peopleActions.fields.preferredName"), type: "text" },
    { name: "jobTitle", label: t("peopleActions.fields.jobTitle"), type: "text" },
    { name: "workEmail", label: t("peopleActions.fields.workEmail"), type: "email" },
    { name: "workPhone", label: t("peopleActions.fields.workPhone"), type: "tel" },
    { name: "lifecycleStatus", label: t("peopleActions.fields.lifecycle"), type: "select", required: true, options: lifecycleOptions },
    { name: "reason", label: t("peopleActions.fields.reason"), type: "textarea", required: true },
  ];
}

type Credentials = { userId: string; username: string; temporaryPassword: string; expiresAt: string };

function usePlatformCommand() {
  const router = useRouter();
  const toast = useToast();
  return async <T,>(body: Record<string, unknown>, success: string) => {
    const result = await engineeringApi<T>("/api/platform-admin/command", { body });
    toast({ title: success, tone: "success" });
    router.refresh();
    return result;
  };
}

export function CreatePersonButton({ groups }: { groups: Array<{ value: string; label: string }> }) {
  const [open, setOpen] = React.useState(false);
  const t = useTranslations("adminAccess");
  const personFields = usePersonFields();
  const command = usePlatformCommand();
  return <><Button size="sm" onClick={() => setOpen(true)}>{t("peopleActions.createPerson")}</Button><FormDialog open={open} onOpenChange={setOpen} title={t("peopleActions.createPersonTitle")} description={t("peopleActions.createPersonDescription")} fields={[{ name: "parentGroupId", label: t("peopleActions.fields.parentGroup"), type: "select", required: true, options: groups }, ...personFields]} initial={{ parentGroupId: groups[0]?.value, lifecycleStatus: "EMPLOYEE" }} submitLabel={t("peopleActions.createPerson")} wide onSubmit={(payload) => command({ action: "person.create", ...payload }, t("peopleActions.personCreated")).then(() => undefined)} /></>;
}

export function EditPersonButton({ person }: { person: { id: string; firstName: string; lastName: string; preferredName: string | null; jobTitle: string | null; workEmail: string | null; workPhone: string | null; lifecycleStatus: string } }) {
  const [open, setOpen] = React.useState(false);
  const t = useTranslations("adminAccess");
  const personFields = usePersonFields();
  const command = usePlatformCommand();
  return <><Button size="sm" variant="ghost" onClick={() => setOpen(true)}>{t("peopleActions.edit")}</Button><FormDialog open={open} onOpenChange={setOpen} title={t("peopleActions.editTitle", { name: `${person.firstName} ${person.lastName}` })} fields={personFields} initial={person} submitLabel={t("peopleActions.save")} wide onSubmit={(payload) => command({ action: "person.update", personId: person.id, ...payload }, t("peopleActions.personUpdated")).then(() => undefined)} /></>;
}

export function CreateUserButton({ personId, personName }: { personId: string; personName: string }) {
  const [open, setOpen] = React.useState(false);
  const [created, setCreated] = React.useState<Credentials | null>(null);
  const t = useTranslations("adminAccess");
  const command = usePlatformCommand();
  return <>
    <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>{t("peopleActions.createAccount")}</Button>
    <FormDialog open={open} onOpenChange={setOpen} title={t("peopleActions.createAccountTitle", { name: personName })} description={t("peopleActions.createAccountDescription")} fields={[{ name: "username", label: t("peopleActions.username"), type: "text", hint: t("peopleActions.usernameHint") }, { name: "reason", label: t("peopleActions.fields.reason"), type: "textarea", required: true }]} submitLabel={t("peopleActions.createAccount")} saveKind="none" onSubmit={async (payload) => setCreated(await command<Credentials>({ action: "user.create", personProfileId: personId, ...payload }, t("peopleActions.accountCreated")))} />
    <Dialog open={created !== null} onOpenChange={(next) => !next && setCreated(null)}><DialogContent className="max-w-md"><DialogTitle>{t("peopleActions.credentialsTitle")}</DialogTitle><DialogDescription>{t("peopleActions.credentialsDescription")}</DialogDescription>{created ? <dl className="mt-4 space-y-3"><div><dt className="text-meta text-fg-subtle">{t("peopleActions.username")}</dt><dd className="flex items-center gap-2 font-mono text-body">{created.username}<CopyButton value={created.username} label={t("peopleActions.copyUsername")} /></dd></div><div><dt className="text-meta text-fg-subtle">{t("peopleActions.temporaryPassword")}</dt><dd className="flex items-center gap-2 font-mono text-body">{created.temporaryPassword}<CopyButton value={created.temporaryPassword} label={t("peopleActions.copyPassword")} /></dd></div></dl> : null}<DialogFooter><Button onClick={() => setCreated(null)}>{t("peopleActions.done")}</Button></DialogFooter></DialogContent></Dialog>
  </>;
}
