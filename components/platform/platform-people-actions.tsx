"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, type FormField } from "@/components/engineering/form-kit";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

const lifecycleOptions = ["CANDIDATE", "SELECTED", "EMPLOYEE", "FORMER_EMPLOYEE"].map((value) => ({ value, label: value.replaceAll("_", " ") }));
const personFields: FormField[] = [
  { name: "firstName", label: "First name", type: "text", required: true },
  { name: "lastName", label: "Last name", type: "text", required: true },
  { name: "preferredName", label: "Preferred name", type: "text" },
  { name: "jobTitle", label: "Job title", type: "text" },
  { name: "workEmail", label: "Work email", type: "email" },
  { name: "workPhone", label: "Work phone", type: "text" },
  { name: "lifecycleStatus", label: "Lifecycle", type: "select", required: true, options: lifecycleOptions },
  { name: "reason", label: "Reason", type: "textarea", required: true },
];

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
  const command = usePlatformCommand();
  return <><Button size="sm" onClick={() => setOpen(true)}>Create person</Button><FormDialog open={open} onOpenChange={setOpen} title="Create person" description="Creates a canonical person profile. Login access is provisioned separately." fields={[{ name: "parentGroupId", label: "Parent group", type: "select", required: true, options: groups }, ...personFields]} initial={{ parentGroupId: groups[0]?.value, lifecycleStatus: "EMPLOYEE" }} submitLabel="Create person" wide onSubmit={(payload) => command({ action: "person.create", ...payload }, "Person created.").then(() => undefined)} /></>;
}

export function EditPersonButton({ person }: { person: { id: string; firstName: string; lastName: string; preferredName: string | null; jobTitle: string | null; workEmail: string | null; workPhone: string | null; lifecycleStatus: string } }) {
  const [open, setOpen] = React.useState(false);
  const command = usePlatformCommand();
  return <><Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Edit</Button><FormDialog open={open} onOpenChange={setOpen} title={`Edit ${person.firstName} ${person.lastName}`} fields={personFields} initial={person} submitLabel="Save" wide onSubmit={(payload) => command({ action: "person.update", personId: person.id, ...payload }, "Person updated.").then(() => undefined)} /></>;
}

export function CreateUserButton({ personId, personName }: { personId: string; personName: string }) {
  const [open, setOpen] = React.useState(false);
  const [created, setCreated] = React.useState<Credentials | null>(null);
  const command = usePlatformCommand();
  return <>
    <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Create account</Button>
    <FormDialog open={open} onOpenChange={setOpen} title={`Create account for ${personName}`} description="The password is shown once and expires automatically. The user must replace it on first sign-in." fields={[{ name: "username", label: "Username", type: "text", hint: "Leave blank to generate from the person's name." }, { name: "reason", label: "Reason", type: "textarea", required: true }]} submitLabel="Create account" onSubmit={async (payload) => setCreated(await command<Credentials>({ action: "user.create", personProfileId: personId, ...payload }, "Account created."))} />
    <Dialog open={created !== null} onOpenChange={(next) => !next && setCreated(null)}><DialogContent className="max-w-md"><DialogTitle>Account created</DialogTitle><DialogDescription>Copy these credentials now. The temporary password cannot be shown again.</DialogDescription>{created ? <dl className="mt-4 space-y-3"><div><dt className="text-meta text-fg-subtle">Username</dt><dd className="flex items-center gap-2 font-mono text-body">{created.username}<CopyButton value={created.username} label="Copy username" /></dd></div><div><dt className="text-meta text-fg-subtle">Temporary password</dt><dd className="flex items-center gap-2 font-mono text-body">{created.temporaryPassword}<CopyButton value={created.temporaryPassword} label="Copy password" /></dd></div></dl> : null}<DialogFooter><Button onClick={() => setCreated(null)}>Done</Button></DialogFooter></DialogContent></Dialog>
  </>;
}
