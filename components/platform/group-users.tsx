"use client";

import * as React from "react";
import { MoreHorizontal } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { engineeringApi, failureMessage, isFailure } from "@/components/engineering/engineering-api";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { EditPersonDialog } from "@/components/platform/platform-people-actions";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";

type Account = { id: string; name: string; username: string; email: string | null };
type Added = { userId: string; username: string; temporaryPassword?: string };
type GroupRole = "OWNER" | "GROUP_IT";

const field = "h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-table text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

const command = <T,>(body: Record<string, unknown>) => engineeringApi<T>("/api/platform-admin/command", { body });

/**
 * Add User from inside a Parent Group (Admin PRD #8 §22-§29): a new account or
 * an existing one, the group already known. The Group CEO flavour has the role
 * fixed and asks before it replaces the current CEO. One transaction on the
 * server; nothing is half-applied.
 */
export function AddGroupUser({ groupId, groupName, hasCompany, ceoName, ceoOnly = false, label }: { groupId: string; groupName: string; hasCompany: boolean; ceoName: string | null; ceoOnly?: boolean; label: string }) {
  const t = useTranslations("adminOrgs");
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<"new" | "existing">("new");
  const [roleKey, setRoleKey] = React.useState<GroupRole>(ceoOnly ? "OWNER" : "GROUP_IT");
  const [form, setForm] = React.useState({ firstName: "", lastName: "", username: "", email: "" });
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<Account[]>([]);
  const [chosen, setChosen] = React.useState<Account | null>(null);
  const [replace, setReplace] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [existingOffer, setExistingOffer] = React.useState<{ userId: string; name: string } | null>(null);
  const [pending, setPending] = React.useState(false);
  const [created, setCreated] = React.useState<Added | null>(null);
  const replacing = roleKey === "OWNER" && ceoName !== null && chosen?.name !== ceoName;

  function reset() {
    setMode("new"); setForm({ firstName: "", lastName: "", username: "", email: "" }); setQuery(""); setResults([]); setChosen(null); setReplace(false); setError(null); setExistingOffer(null);
    setRoleKey(ceoOnly ? "OWNER" : "GROUP_IT");
  }

  React.useEffect(() => {
    if (!open || mode !== "existing" || chosen) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      engineeringApi<Account[]>(`/api/platform-admin/groups/${encodeURIComponent(groupId)}/eligible-users?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then(setResults, (failure: unknown) => { if (!controller.signal.aborted) setError(failureMessage(failure)); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, mode, groupId, query, chosen]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setExistingOffer(null);
    if (mode === "existing" && !chosen) return setError(t("users.add.chooseAccount"));
    if (replacing && !replace) return setError(t("groupUsers.replaceRequired", { current: ceoName ?? "" }));
    setPending(true);
    try {
      const base = { action: "group.user.add", groupId, roleKey, replaceCurrent: replacing && replace };
      const result = await command<Added>(mode === "new" ? { ...base, mode, ...form } : { ...base, mode, userId: chosen!.id });
      toast({ title: t("groupUsers.added", { group: groupName }), tone: "success" });
      setOpen(false);
      reset();
      if (result.temporaryPassword) setCreated(result);
      router.refresh();
    } catch (failure) {
      if (isFailure(failure) && failure.details && typeof failure.details === "object" && (failure.details as { code?: string }).code === "ACCOUNT_EXISTS") {
        const details = failure.details as { userId: string; name: string };
        setExistingOffer({ userId: details.userId, name: details.name });
      }
      setError(`${failureMessage(failure, t("groupUsers.failed", { group: groupName }))} ${t("users.add.noChanges")}`);
    } finally {
      setPending(false);
    }
  }

  function useExisting() {
    if (!existingOffer) return;
    setMode("existing");
    setChosen({ id: existingOffer.userId, name: existingOffer.name, username: "", email: form.email });
    setExistingOffer(null);
    setError(null);
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} data-testid={ceoOnly ? "group-assign-ceo" : "group-add-user"}>{label}</Button>
      <Dialog open={open} locked={pending} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
        <DialogContent className="max-h-[92dvh] max-w-xl overflow-y-auto" data-testid="group-add-user-dialog">
          <DialogTitle>{ceoOnly ? t("groupUsers.ceoTitle", { group: groupName }) : t("users.add.title", { target: groupName })}</DialogTitle>
          <DialogDescription>{hasCompany ? t("groupUsers.addDescription") : t("tabs.users.needCompany")}</DialogDescription>
          {hasCompany ? (
            <form onSubmit={submit} className="mt-4 space-y-4">
              <div role="radiogroup" aria-label={t("users.add.accountGroup")} className="flex flex-wrap gap-4 text-table">
                <label className="flex items-center gap-2"><input type="radio" name="group-mode" checked={mode === "new"} onChange={() => { setMode("new"); setChosen(null); }} />{t("users.add.createNew")}</label>
                <label className="flex items-center gap-2"><input type="radio" name="group-mode" checked={mode === "existing"} onChange={() => setMode("existing")} />{t("users.add.addExisting")}</label>
              </div>
              {mode === "new" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-1 text-meta text-fg-subtle">{t("users.add.firstName")}<input className={field} value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} required maxLength={80} /></label>
                  <label className="block space-y-1 text-meta text-fg-subtle">{t("users.add.lastName")}<input className={field} value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} required maxLength={80} /></label>
                  <label className="block space-y-1 text-meta text-fg-subtle">{t("users.add.username")}<input className={field} value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} maxLength={60} autoCapitalize="none" /></label>
                  <label className="block space-y-1 text-meta text-fg-subtle">{t("users.add.email")}<input type="email" className={field} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required maxLength={200} /></label>
                </div>
              ) : chosen ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-line p-2.5 text-table">
                  <span><span className="font-medium text-fg">{chosen.name}</span>{chosen.email ? <span className="block text-meta text-fg-subtle">{chosen.email}</span> : null}</span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setChosen(null)}>{t("users.add.change")}</Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <input className={field} placeholder={t("users.add.searchPlaceholder")} aria-label={t("users.add.searchAria")} value={query} onChange={(event) => setQuery(event.target.value)} />
                  <ul className="max-h-48 divide-y divide-line overflow-y-auto rounded-lg border border-line" aria-label={t("users.add.accountsAria")}>
                    {results.length === 0 ? <li className="p-2.5 text-meta text-fg-subtle">{t("users.add.noEligible")}</li> : results.map((row) => (
                      <li key={row.id}><button type="button" className="w-full px-2.5 py-2 text-left text-table hover:bg-hover" onClick={() => setChosen(row)}><span className="font-medium text-fg">{row.name}</span><span className="block text-meta text-fg-subtle">{row.email ?? row.username}</span></button></li>
                    ))}
                  </ul>
                </div>
              )}
              <label className="block space-y-1 text-meta text-fg-subtle">{t("groupUsers.role")}
                <select className={field} value={roleKey} onChange={(event) => { setRoleKey(event.target.value as GroupRole); setReplace(false); }} disabled={ceoOnly} required>
                  <option value="OWNER">{t("groupUsers.roleOWNER")}</option>
                  <option value="GROUP_IT">{t("groupUsers.roleGROUP_IT")}</option>
                </select>
              </label>
              {replacing ? (
                <label className="flex items-start gap-2 rounded-lg border border-line bg-warning-soft p-2.5 text-table text-fg" data-testid="group-replace-ceo">
                  <input type="checkbox" className="mt-1" checked={replace} onChange={(event) => setReplace(event.target.checked)} />
                  <span><span className="font-medium">{t("groupUsers.replaceConfirm")}</span><span className="block text-meta text-fg-muted">{t("groupUsers.replaceNotice", { current: ceoName ?? "", group: groupName })}</span></span>
                </label>
              ) : null}
              {error ? <p role="alert" className="text-table text-danger">{error}</p> : null}
              {existingOffer ? <Button type="button" size="sm" variant="secondary" onClick={useExisting}>{t("users.add.addExistingUser")}</Button> : null}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => { setOpen(false); reset(); }} disabled={pending}>{t("users.add.cancel")}</Button>
                <Button type="submit" disabled={pending}>{ceoOnly ? t("groupUsers.assignCeo") : mode === "new" ? t("users.add.createUser") : t("users.add.addUser")}</Button>
              </DialogFooter>
            </form>
          ) : <DialogFooter><Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t("users.add.cancel")}</Button></DialogFooter>}
        </DialogContent>
      </Dialog>
      <Dialog open={created !== null} onOpenChange={(next) => !next && setCreated(null)}>
        <DialogContent className="max-w-md">
          <DialogTitle>{t("users.add.createdTitle")}</DialogTitle>
          <DialogDescription>{t("users.add.createdDescription")}</DialogDescription>
          {created ? <dl className="mt-4 space-y-3"><div><dt className="text-meta text-fg-subtle">{t("users.add.username")}</dt><dd className="flex items-center gap-2 font-mono text-body">{created.username}<CopyButton value={created.username} label={t("users.add.copyUsername")} /></dd></div><div><dt className="text-meta text-fg-subtle">{t("users.add.temporaryPassword")}</dt><dd className="flex items-center gap-2 font-mono text-body">{created.temporaryPassword}<CopyButton value={created.temporaryPassword ?? ""} label={t("users.add.copyPassword")} /></dd></div></dl> : null}
          <DialogFooter><Button onClick={() => setCreated(null)}>{t("users.add.done")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * One group member's menu (§40, §41, §43): every action is this group's only.
 * "Remove from Group" never deletes the account, and company access stays
 * unless the box is ticked.
 */
export function GroupPersonActions({ groupId, groupName, person, ceoName }: { groupId: string; groupName: string; person: { userId: string; name: string; roleKey: GroupRole | null; seatActive: boolean; profile: { id: string; firstName: string; lastName: string; preferredName: string | null; jobTitle: string | null; workEmail: string | null; workPhone: string | null; lifecycleStatus: string } | null }; ceoName: string | null }) {
  const t = useTranslations("adminOrgs");
  const router = useRouter();
  const toast = useToast();
  const [dialog, setDialog] = React.useState<"ceo" | "remove" | "delete" | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [alsoCompanies, setAlsoCompanies] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const isCeo = person.roleKey === "OWNER";
  const replacing = ceoName !== null && !isCeo;

  async function run(body: Record<string, unknown>, success: string) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await command(body);
      toast({ title: success, tone: "success" });
      setDialog(null);
      router.refresh();
    } catch (failure) {
      setError(`${failureMessage(failure)} ${t("users.member.noChanges")}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" variant="ghost" aria-label={t("users.member.actionsFor", { name: person.name })} data-testid="group-person-actions"><MoreHorizontal aria-hidden="true" className="size-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {person.profile ? <DropdownMenuItem onSelect={() => setEditing(true)}>{t("groupUsers.editPerson")}</DropdownMenuItem> : null}
          {person.seatActive && person.roleKey && !isCeo ? <DropdownMenuItem onSelect={() => { setError(null); setDialog("ceo"); }}>{t("groupUsers.makeCeo")}</DropdownMenuItem> : null}
          {person.seatActive ? <DropdownMenuItem onSelect={() => { setError(null); setAlsoCompanies(false); setDialog("remove"); }} className="text-danger">{t("groupUsers.removeFromGroup")}</DropdownMenuItem> : null}
          <DropdownMenuItem onSelect={() => { setError(null); setDialog("delete"); }} className="text-danger">{t("groupUsers.deleteAccount")}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild><Link href={`/admin/users/${person.userId}`}>{t("users.member.viewAccount")}</Link></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={dialog !== null} locked={pending} onOpenChange={(next) => !next && setDialog(null)}>
        <DialogContent className="max-w-md">
          {dialog === "delete" ? (
            <>
              <DialogTitle>{t("groupUsers.deleteTitle", { name: person.name })}</DialogTitle>
              <DialogDescription>{t("groupUsers.deleteDescription", { name: person.name, group: groupName })}</DialogDescription>
            </>
          ) : dialog === "remove" ? (
            <>
              <DialogTitle>{t("groupUsers.removeTitle", { name: person.name, group: groupName })}</DialogTitle>
              <DialogDescription>{t("groupUsers.removeDescription", { name: person.name })}</DialogDescription>
              <label className="mt-4 flex items-start gap-2 text-table text-fg"><input type="checkbox" className="mt-1" checked={alsoCompanies} onChange={(event) => setAlsoCompanies(event.target.checked)} />{t("groupUsers.alsoCompanies")}</label>
            </>
          ) : (
            <>
              <DialogTitle>{t("groupUsers.makeCeoTitle", { group: groupName })}</DialogTitle>
              <DialogDescription>{replacing ? t("groupUsers.replaceNotice", { current: ceoName ?? "", group: groupName }) : t("groupUsers.makeCeoDescription", { name: person.name })}</DialogDescription>
            </>
          )}
          {error ? <p role="alert" className="mt-3 text-table text-danger">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDialog(null)} disabled={pending}>{t("users.member.cancel")}</Button>
            {dialog === "remove" ? <Button variant="danger" disabled={pending} onClick={() => run({ action: "group.user.remove", groupId, userId: person.userId, alsoRemoveCompanyAccess: alsoCompanies }, t("groupUsers.removed", { group: groupName }))}>{t("groupUsers.removeFromGroup")}</Button> : null}
            {dialog === "delete" ? <Button variant="danger" disabled={pending} onClick={() => run({ action: "user.delete", userId: person.userId }, t("groupUsers.deleted"))}>{t("groupUsers.deleteAccount")}</Button> : null}
            {dialog === "ceo" ? <Button disabled={pending} onClick={() => run({ action: "group.user.add", mode: "existing", groupId, userId: person.userId, roleKey: "OWNER", replaceCurrent: replacing }, t("groupUsers.ceoChanged", { name: person.name }))}>{t("groupUsers.assignCeo")}</Button> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {person.profile ? <EditPersonDialog open={editing} onOpenChange={setEditing} person={person.profile} /> : null}
    </>
  );
}
