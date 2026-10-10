"use client";

import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { engineeringApi, failureMessage, isFailure } from "@/components/engineering/engineering-api";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { adminRoleName } from "@/components/platform/admin-roles";
import { useGroupUserNav } from "@/components/platform/group-user-drawer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import type { CompanyUserDetail, CompanyUserRemovalPreview } from "@/lib/modules/platform/company-users.service";
import { FormSelect } from "@/components/ui/form-select";

export type CompanyUsersApi = { command: string };
export type CompanyUserOptions = { roles: { key: string; name: string }[]; departments: { id: string; name: string }[]; projects: { id: string; name: string }[] };

const dateFormat = (value: string) => new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const dateTimeFormat = (value: string) => new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const field = "h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-table text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "gone" } | { state: "ready"; detail: CompanyUserDetail };
type ActivityKey = keyof typeof import("@/lib/i18n/modules/adminOrgs/en").adminOrgsEn.companyUsers.act;

/**
 * One person's relationship with this company, beside the Users table (PRD
 * #13 §37-§47). The open person lives in the address (`?user=`), so the list,
 * its search, filters and page stay exactly as they were when it closes, and
 * Back and Forward walk through it. Everything shown and every action comes
 * from the server's answer; the same commands serve the Platform Admin and the
 * group's own seats.
 */
export function CompanyUserDrawer(props: { companyId: string; companyName: string; groupName: string | null; api: CompanyUsersApi; options: CompanyUserOptions; platform?: boolean; leadershipHref?: string }) {
  const params = useSearchParams();
  const userId = params.get("user");
  const [lastId, setLastId] = React.useState<string | null>(userId);
  React.useEffect(() => { if (userId) setLastId(userId); }, [userId]);
  const shown = userId ?? lastId;
  if (!shown) return null;
  return <DrawerBody key={shown} open={Boolean(userId)} userId={shown} {...props} />;
}

function DrawerBody({ open, userId, companyId, companyName, groupName, api, options, platform = true, leadershipHref }: { open: boolean; userId: string; companyId: string; companyName: string; groupName: string | null; api: CompanyUsersApi; options: CompanyUserOptions; platform?: boolean; leadershipHref?: string }) {
  const t = useTranslations("adminOrgs");
  const tr = useTranslations("roles");
  const router = useRouter();
  const toast = useToast();
  const { close } = useGroupUserNav();
  const [load, setLoad] = React.useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = React.useState(0);
  const [dialog, setDialog] = React.useState<"edit" | "suspend" | "reactivate" | "remove" | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<CompanyUserRemovalPreview | null>(null);
  const [more, setMore] = React.useState<{ rows: CompanyUserDetail["activity"]["rows"]; next: string | null } | null>(null);
  const refetch = React.useCallback(() => setAttempt((value) => value + 1), []);

  React.useEffect(() => {
    const controller = new AbortController();
    engineeringApi<CompanyUserDetail>(api.command, { body: { action: "company.users.detail", companyId, userId }, signal: controller.signal })
      .then((detail) => { setLoad({ state: "ready", detail }); setMore(null); })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        // Removed, never here or not this actor's to see read the same (§152, §204).
        if (isFailure(failure) && (failure.code === "NOT_FOUND" || failure.code === "FORBIDDEN")) setLoad({ state: "gone" });
        else setLoad({ state: "error", message: failureMessage(failure, "") });
      });
    return () => controller.abort();
  }, [api.command, companyId, userId, attempt]);

  const detail = load.state === "ready" ? load.detail : null;
  const name = detail?.name ?? "";
  const role = (value: string | null) => (value ? adminRoleName(tr, value) : "");

  async function act(body: Record<string, unknown>, success: string, failed: string, after?: () => void) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await engineeringApi(api.command, { body: { companyId, userId, ...body } });
      toast({ title: success, tone: "success" });
      setDialog(null);
      after?.();
      refetch();
      router.refresh();
    } catch (failure) {
      // Nothing was applied, and the row stays until the server says it is gone (§153, §154).
      setError(`${failureMessage(failure, failed)}${isFailure(failure) && failure.code === "CONFLICT" ? "" : ` ${failed}`}`);
    } finally {
      setPending(false);
    }
  }

  async function startRemove() {
    setError(null); setPreview(null); setDialog("remove");
    try {
      setPreview(await engineeringApi<CompanyUserRemovalPreview>(api.command, { body: { action: "company.users.removePreview", companyId, userId } }));
    } catch (failure) {
      setError(failureMessage(failure));
    }
  }

  async function loadMore() {
    if (!detail) return;
    const cursor = more ? more.next : detail.activity.nextCursor;
    if (!cursor) return;
    try {
      const page = await engineeringApi<CompanyUserDetail["activity"]>(api.command, { body: { action: "company.users.activity", companyId, userId, cursor } });
      setMore({ rows: [...(more?.rows ?? []), ...page.rows], next: page.nextCursor });
    } catch (failure) {
      toast({ title: failureMessage(failure), tone: "danger" });
    }
  }

  const activity = detail ? [...detail.activity.rows, ...(more?.rows ?? [])] : [];
  const nextCursor = more ? more.next : detail?.activity.nextCursor ?? null;
  const sourceLabel = detail ? (detail.source === "DIRECT" ? t("companyUsers.sourceDirect") : detail.source === "BOTH" ? t("companyUsers.sourceBoth") : t("companyUsers.sourceGroup", { group: groupName ?? "" })) : "";
  const headline = detail ? (detail.directRole ?? detail.groupRole) : null;

  return (
    <>
      <Drawer open={open} onOpenChange={(next) => { if (!next) close(); }}>
        <DrawerContent
          side="right"
          className="max-sm:w-full max-sm:max-w-none sm:max-w-[520px]"
          onCloseAutoFocus={(event) => {
            const opener = document.querySelector<HTMLElement>(`[data-company-user="${CSS.escape(userId)}"]`);
            if (opener) { event.preventDefault(); opener.focus(); }
          }}
          data-testid="company-user-drawer"
          aria-describedby="company-user-desc"
        >
          <header className="space-y-1 border-b border-line px-5 py-4">
            <DrawerTitle className="text-card font-semibold text-fg">{detail ? name : load.state === "loading" ? t("companyUsers.loading") : t("companyUsers.drawerTitle")}</DrawerTitle>
            <DrawerDescription id="company-user-desc" className="text-table text-fg-muted">
              {detail ? `${role(headline)}${detail.isCeo ? ` · ${t("companyUsers.ceoBadge")}` : ""}` : companyName}
            </DrawerDescription>
            {detail ? (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <AdminStatusBadge status={detail.accountStatus !== "ACTIVE" ? detail.accountStatus : detail.membershipStatus} />
                <span className="font-mono text-micro text-fg-subtle">{detail.email ?? detail.username}</span>
              </div>
            ) : null}
          </header>

          <div className="flex-1 space-y-6 px-5 py-4" aria-live="polite">
            {load.state === "loading" ? (
              <div className="space-y-3" role="status" aria-label={t("companyUsers.loading")}><Skeleton className="h-5 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>
            ) : load.state === "gone" ? (
              <div className="space-y-3"><p className="text-table text-fg" role="alert">{t("companyUsers.gone", { company: companyName })}</p><Button variant="secondary" onClick={close}>{t("companyUsers.close")}</Button></div>
            ) : load.state === "error" ? (
              <div className="space-y-3"><p className="text-table text-danger" role="alert">{t("companyUsers.loadUserFailed")} {load.message}</p><Button variant="secondary" onClick={() => { setLoad({ state: "loading" }); refetch(); }}>{t("companyUsers.tryAgain")}</Button></div>
            ) : detail ? (
              <>
                {detail.accountStatus !== "ACTIVE" ? <p role="alert" className="rounded-lg border border-line bg-warning-soft p-2.5 text-table text-fg">{t("companyUsers.accountSuspendedNote", { name })}</p> : null}
                {detail.membershipStatus === "SUSPENDED" ? <p role="status" className="rounded-lg border border-line bg-warning-soft p-2.5 text-table text-fg">{t("companyUsers.directSuspendedNote", { name })}</p> : null}
                {detail.isCeo ? <p role="status" className="rounded-lg border border-line p-2.5 text-table text-fg-muted">{t("companyUsers.ceoProtected", { name })}</p> : null}

                <section aria-labelledby="cu-overview" className="space-y-2">
                  <h2 id="cu-overview" className="text-meta font-semibold uppercase tracking-wide text-fg-subtle">{t("companyUsers.sectionOverview")}</h2>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-table">
                    <dt className="text-fg-subtle">{t("companyUsers.fieldStatus")}</dt><dd><AdminStatusBadge status={detail.accountStatus !== "ACTIVE" ? detail.accountStatus : detail.membershipStatus} /></dd>
                    {detail.directRole ? (<><dt className="text-fg-subtle">{t("companyUsers.fieldRole")}</dt><dd className="text-fg">{role(detail.directRole)}</dd></>) : null}
                    <dt className="text-fg-subtle">{t("companyUsers.fieldDepartment")}</dt><dd className="text-fg">{detail.department?.name ?? "—"}</dd>
                    <dt className="text-fg-subtle">{t("companyUsers.fieldPosition")}</dt><dd className="text-fg">{detail.jobTitle ?? "—"}</dd>
                    <dt className="text-fg-subtle">{t("companyUsers.fieldSource")}</dt><dd className="text-fg" data-testid="company-user-source">{sourceLabel}</dd>
                    <dt className="text-fg-subtle">{t("companyUsers.sectionProjects")}</dt><dd className="text-fg tabular-nums">{detail.projects}</dd>
                    {detail.joinedAt ? (<><dt className="text-fg-subtle">{t("companyUsers.fieldJoined")}</dt><dd className="text-fg">{dateFormat(detail.joinedAt)}</dd></>) : null}
                  </dl>
                </section>

                {detail.groupAccess ? (
                  <section aria-labelledby="cu-group" className="space-y-2" data-testid="company-user-group-access">
                    <h2 id="cu-group" className="text-meta font-semibold uppercase tracking-wide text-fg-subtle">{t("companyUsers.sectionGroupAccess")}</h2>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-table">
                      <dt className="text-fg-subtle">{t("companyUsers.fieldSource")}</dt><dd className="text-fg">{t("companyUsers.viaGroupLine", { group: detail.groupAccess.groupName })}</dd>
                      <dt className="text-fg-subtle">{t("companyUsers.fieldGroupRole")}</dt><dd className="text-fg">{role(detail.groupAccess.roleName)}</dd>
                    </dl>
                    <p className="text-table text-fg-muted">{detail.source === "GROUP" ? t("companyUsers.groupOnlyNote", { group: detail.groupAccess.groupName }) : t("companyUsers.groupAccessInfo", { group: detail.groupAccess.groupName })}</p>
                    {!detail.can.manageGroupAccess ? <p className="text-table text-fg-muted">{t("companyUsers.contactGroupAdmin")}</p> : null}
                  </section>
                ) : null}

                <section aria-labelledby="cu-projects" className="space-y-2" data-testid="company-user-projects">
                  <h2 id="cu-projects" className="text-meta font-semibold uppercase tracking-wide text-fg-subtle">{t("companyUsers.sectionProjects")}{detail.projectAccess.length ? ` · ${detail.projectAccess.length}` : ""}</h2>
                  {detail.projectAccess.length === 0 ? <p className="text-table text-fg-muted">{t("companyUsers.noProjectAccess")}</p> : (
                    <ul className="divide-y divide-line rounded-lg border border-line">
                      {detail.projectAccess.map((row) => (
                        <li key={row.projectId} className="px-3 py-2"><p className="text-table font-medium text-fg">{row.projectName}</p>{row.role ? <p className="text-meta text-fg-muted">{row.role}</p> : null}</li>
                      ))}
                    </ul>
                  )}
                </section>

                <section aria-labelledby="cu-activity" className="space-y-2" data-testid="company-user-activity">
                  <h2 id="cu-activity" className="text-meta font-semibold uppercase tracking-wide text-fg-subtle">{t("companyUsers.sectionActivity")}</h2>
                  {activity.length === 0 ? <p className="text-table text-fg-muted">{t("companyUsers.noActivity")}</p> : (
                    <ul className="divide-y divide-line">
                      {activity.map((row) => (
                        <li key={row.id} className="py-2">
                          <p className="text-table text-fg">{t(`companyUsers.act.${row.actionKey as ActivityKey}`)}{row.detail ? <span className="text-fg-muted"> · {row.detail}</span> : null}</p>
                          <p className="text-meta text-fg-subtle">{dateTimeFormat(row.occurredAt)}{row.actorName ? ` · ${row.actorName}` : ""}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                  {nextCursor ? <Button size="sm" variant="ghost" onClick={loadMore}>{t("companyUsers.loadMore")}</Button> : null}
                </section>
              </>
            ) : null}
          </div>

          {detail ? (
            <footer className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-line bg-sidebar px-5 py-3">
              <Button variant="ghost" onClick={close}>{t("companyUsers.close")}</Button>
              <div className="flex items-center gap-2">
                {detail.isCeo && leadershipHref ? <Button variant="secondary" asChild><Link href={leadershipHref}>{t("companyUsers.leadership")}</Link></Button> : null}
                {detail.can.editAccess ? <Button onClick={() => { setError(null); setDialog("edit"); }} data-testid="company-user-edit">{t("companyUsers.editAccess")}</Button> : null}
                {detail.can.reactivate ? <Button disabled={pending} onClick={() => { setError(null); setDialog("reactivate"); }}>{t("companyUsers.menuReactivate")}</Button> : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button type="button" variant="ghost" aria-label={t("companyUsers.more")} data-testid="company-user-more"><MoreHorizontal aria-hidden="true" className="size-4" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {detail.can.suspend ? <DropdownMenuItem onSelect={() => { setError(null); setDialog("suspend"); }}>{t("companyUsers.menuSuspend")}</DropdownMenuItem> : null}
                    {detail.can.removeDirect ? <DropdownMenuItem onSelect={() => void startRemove()} className="text-danger">{detail.source === "BOTH" ? t("companyUsers.menuRemoveDirect") : t("companyUsers.menuRemove")}</DropdownMenuItem> : null}
                    {platform ? (
                      <>
                        {detail.can.suspend || detail.can.removeDirect ? <DropdownMenuSeparator /> : null}
                        <DropdownMenuItem asChild><Link href={`/admin/users/${detail.userId}?from=${companyId}`}>{t("companyUsers.menuAccount")}</Link></DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </footer>
          ) : null}
        </DrawerContent>
      </Drawer>

      {detail ? (
        <>
          <EditAccessDialog open={dialog === "edit"} onClose={() => { setDialog(null); }} detail={detail} options={options} api={api} companyId={companyId} companyName={companyName} onSaved={() => { setDialog(null); refetch(); router.refresh(); }} onConflict={() => { setDialog(null); refetch(); }} />
          <Dialog open={dialog === "suspend" || dialog === "reactivate" || dialog === "remove"} locked={pending} onOpenChange={(next) => !next && setDialog(null)}>
            <DialogContent className="max-w-md" data-testid="company-user-dialog">
              {dialog === "suspend" ? (
                <>
                  <DialogTitle>{t("companyUsers.suspendTitle")}</DialogTitle>
                  <DialogDescription>{t("companyUsers.suspendBody", { name, role: role(detail.directRole), company: companyName })}</DialogDescription>
                </>
              ) : dialog === "reactivate" ? (
                <>
                  <DialogTitle>{t("companyUsers.reactivateTitle")}</DialogTitle>
                  <DialogDescription>{t("companyUsers.reactivateBody", { name, role: role(detail.directRole), company: companyName })}</DialogDescription>
                </>
              ) : dialog === "remove" ? (
                <>
                  <DialogTitle>{preview?.kind === "BOTH" || detail.source === "BOTH" ? t("companyUsers.removeTitleBoth", { name }) : t("companyUsers.removeTitleDirect", { name, company: companyName })}</DialogTitle>
                  {preview ? (
                    <div className="space-y-3 text-table text-fg" data-testid="company-user-remove-preview">
                      <p>{t("companyUsers.removeLose", { name })}</p>
                      <ul className="list-disc space-y-1 pl-5">
                        {preview.roleName ? <li>{t("companyUsers.loseRole", { role: role(preview.roleName) })}</li> : null}
                        {preview.kind === "DIRECT" ? <li>{t("companyUsers.losePermissions")}</li> : null}
                      </ul>
                      {preview.projects.length > 0 ? <div><p className="font-medium">{t("companyUsers.projectsAffected")}</p><ul className="list-disc pl-5">{preview.projects.map((project) => <li key={project}>{project}</li>)}</ul></div> : null}
                      {preview.stillViaGroup ? <p className="text-fg-muted">{t("companyUsers.stillViaGroup", { name, group: groupName ?? "", role: role(preview.stillViaGroup.roleName) })}</p> : <p className="text-fg-muted">{t("companyUsers.accountKept")}</p>}
                      {preview.blocked ? <p role="alert" className="text-danger">{preview.blocked === "COMPANY_CEO" ? t("companyUsers.blockedCeo", { name }) : preview.blocked === "SELF" ? t("companyUsers.blockedSelf") : t("companyUsers.blockedGroup")}</p> : null}
                    </div>
                  ) : !error ? <Skeleton className="mt-3 h-24 w-full" /> : null}
                </>
              ) : null}
              {error ? <p role="alert" className="mt-3 text-table text-danger">{error}</p> : null}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setDialog(null)} disabled={pending}>{t("companyUsers.cancel")}</Button>
                {dialog === "suspend" ? <Button variant="danger" disabled={pending} onClick={() => act({ action: "company.users.suspend", expectedVersion: detail.version }, t("companyUsers.suspended_toast", { name }), t("companyUsers.updateFailed", { name }))}>{t("companyUsers.suspendConfirm")}</Button> : null}
                {dialog === "reactivate" ? <Button disabled={pending} onClick={() => act({ action: "company.users.reactivate", expectedVersion: detail.version }, t("companyUsers.reactivated_toast", { name }), t("companyUsers.updateFailed", { name }))}>{t("companyUsers.reactivateConfirm")}</Button> : null}
                {dialog === "remove" ? (
                  <Button variant="danger" disabled={pending || !preview || preview.blocked !== null} onClick={() => act({ action: "company.users.remove", expectedVersion: detail.version }, preview?.kind === "BOTH" ? t("companyUsers.removedDirect_toast", { name }) : t("companyUsers.removed_toast", { name, company: companyName }), t("companyUsers.removeFailed", { name }), preview?.kind === "BOTH" ? undefined : close)}>
                    {preview?.kind === "BOTH" ? t("companyUsers.removeConfirmBoth") : t("companyUsers.removeConfirmDirect")}
                  </Button>
                ) : null}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </>
  );
}

/**
 * Edit Access (§48-§54): role, department, position and projects together,
 * one Save. Only the direct relationship is edited — no group role field
 * exists here (§49) — and closing with unsaved edits asks first (§134).
 */
function EditAccessDialog({ open, onClose, detail, options, api, companyId, companyName, onSaved, onConflict }: { open: boolean; onClose: () => void; detail: CompanyUserDetail; options: CompanyUserOptions; api: CompanyUsersApi; companyId: string; companyName: string; onSaved: () => void; onConflict: () => void }) {
  const t = useTranslations("adminOrgs");
  const tr = useTranslations("roles");
  const toast = useToast();
  const initial = React.useMemo(() => ({ roleKey: detail.directRoleKey ?? "", departmentId: detail.department?.id ?? "", jobTitle: detail.jobTitle ?? "", projectIds: detail.projectAccess.map((row) => row.projectId).sort() }), [detail]);
  const [form, setForm] = React.useState(initial);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  React.useEffect(() => { if (open) { setForm(initial); setError(null); setConfirmDiscard(false); } }, [open, initial]);

  const dirty = form.roleKey !== initial.roleKey || form.departmentId !== initial.departmentId || form.jobTitle.trim() !== initial.jobTitle || [...form.projectIds].sort().join() !== initial.projectIds.join();
  const requestClose = () => { if (pending) return; if (dirty) setConfirmDiscard(true); else onClose(); };

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !dirty) return;
    setPending(true);
    setError(null);
    try {
      await engineeringApi(api.command, {
        body: {
          action: "company.users.update", companyId, userId: detail.userId, expectedVersion: detail.version,
          ...(form.roleKey !== initial.roleKey ? { roleKey: form.roleKey } : {}),
          ...(form.departmentId !== initial.departmentId ? { departmentId: form.departmentId || null } : {}),
          ...(form.jobTitle.trim() !== initial.jobTitle ? { jobTitle: form.jobTitle.trim() } : {}),
          ...([...form.projectIds].sort().join() !== initial.projectIds.join() ? { projectIds: form.projectIds } : {}),
        },
      });
      toast({ title: t("companyUsers.saved", { name: detail.name }), tone: "success" });
      onSaved();
    } catch (failure) {
      if (isFailure(failure) && (failure.details as { code?: string } | undefined)?.code === "ACCESS_CHANGED") {
        toast({ title: failureMessage(failure), tone: "danger" });
        onConflict();
      } else {
        // The form keeps what was typed; nothing was applied (§153).
        setError(`${failureMessage(failure)} ${t("companyUsers.updateFailed", { name: detail.name })}`);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Dialog open={open} locked={pending} onOpenChange={(next) => !next && requestClose()}>
        <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto" data-testid="company-user-edit-dialog">
          <DialogTitle>{t("companyUsers.editTitle", { name: detail.name })}</DialogTitle>
          <DialogDescription>{detail.source === "BOTH" ? t("companyUsers.editGroupNote") : companyName}</DialogDescription>
          <form onSubmit={save} className="mt-4 space-y-4">
            <label className="block space-y-1 text-meta text-fg-subtle">{t("companyUsers.companyRole")}
              <FormSelect className={field} value={form.roleKey} onChange={(event) => setForm({ ...form, roleKey: event.target.value })} disabled={detail.isCeo} required>
                {detail.isCeo ? <option value="">{t("companyUsers.ceoBadge")}</option> : null}
                {options.roles.map((row) => <option key={row.key} value={row.key}>{adminRoleName(tr, row.name)}</option>)}
              </FormSelect>
              {detail.isCeo ? <span className="block text-meta text-fg-muted">{t("companyUsers.ceoNote")}</span> : null}
            </label>
            <label className="block space-y-1 text-meta text-fg-subtle">{t("companyUsers.fieldDepartment")}
              <FormSelect className={field} value={form.departmentId} onChange={(event) => setForm({ ...form, departmentId: event.target.value })}>
                <option value="">{t("companyUsers.noDepartment")}</option>
                {options.departments.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </FormSelect>
            </label>
            <label className="block space-y-1 text-meta text-fg-subtle">{t("companyUsers.fieldPosition")}
              <input className={field} value={form.jobTitle} maxLength={120} onChange={(event) => setForm({ ...form, jobTitle: event.target.value })} />
            </label>
            <fieldset className="space-y-1">
              <legend className="text-meta text-fg-subtle">{t("companyUsers.sectionProjects")}</legend>
              {options.projects.length === 0 ? <p className="text-meta text-fg-subtle">{t("companyUsers.noProjects")}</p> : (
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
                  {options.projects.map((project) => (
                    <label key={project.id} className="flex items-center gap-2 text-table text-fg">
                      <input type="checkbox" checked={form.projectIds.includes(project.id)} onChange={(event) => setForm({ ...form, projectIds: event.target.checked ? [...form.projectIds, project.id] : form.projectIds.filter((id) => id !== project.id) })} />
                      {project.name}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
            {error ? <p role="alert" className="text-table text-danger">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={requestClose} disabled={pending}>{t("companyUsers.cancel")}</Button>
              <Button type="submit" disabled={pending || !dirty}>{t("companyUsers.save")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <DialogContent className="max-w-sm">
          <DialogTitle>{t("companyUsers.discardTitle")}</DialogTitle>
          <DialogDescription>{t("companyUsers.discardBody", { name: detail.name })}</DialogDescription>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDiscard(false)}>{t("companyUsers.keepEditing")}</Button>
            <Button variant="danger" onClick={() => { setConfirmDiscard(false); onClose(); }}>{t("companyUsers.discard")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
