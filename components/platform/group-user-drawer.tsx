"use client";

import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { engineeringApi, failureMessage } from "@/components/engineering/engineering-api";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { EditCompanyAccessDialog } from "@/components/platform/group-company-access";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import type { GroupRemovalPreview, GroupUserActivityRow, GroupUserCompanyRow, GroupUserDetail } from "@/lib/modules/platform/group-user-detail.service";

type Api = { command: string };
type ActionKey = keyof typeof import("@/lib/i18n/modules/adminOrgs/en").adminOrgsEn.groupUser.act;

/*
 * The open person lives in the address (`?user=`), so the page can be shared,
 * refreshed and walked back through (PRD #11 §69, §70). Opening pushes one
 * history entry through the router and Back closes it; the table, its search
 * and its filters stay on the page, untouched.
 */
let openedHere = false;

function withUser(userId: string | null): string {
  const url = new URL(window.location.href);
  if (userId) url.searchParams.set("user", userId); else url.searchParams.delete("user");
  return `${url.pathname}${url.search}`;
}

export function useGroupUserNav() {
  const router = useRouter();
  return React.useMemo(() => ({
    open(userId: string) { openedHere = true; router.push(withUser(userId), { scroll: false }); },
    close() {
      // Opened from the table: step back, so Forward reopens it. Arrived by link: just drop the parameter.
      if (openedHere) { openedHere = false; router.back(); } else router.replace(withUser(null), { scroll: false });
    },
  }), [router]);
}

/** The person's name in the table: opens the drawer, and gets focus back when it closes (§107). */
export function GroupUserOpener({ userId, name, className }: { userId: string; name: string; className?: string }) {
  const t = useTranslations("adminOrgs");
  const nav = useGroupUserNav();
  return (
    <button type="button" data-group-user={userId} aria-label={t("groupUser.open", { name })} onClick={() => nav.open(userId)} className={className ?? "text-left font-medium text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"}>
      {name}
    </button>
  );
}

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "gone"; message: string } | { state: "ready"; detail: GroupUserDetail };

const dateFormat = (value: string) => new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const dateTimeFormat = (value: string) => new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * One person's relationship with this group, beside the Users table (PRD #11).
 * Everything shown and every action comes from the server's answer — the same
 * commands serve the Platform Admin and the group's own seats — so a read-only
 * viewer is simply offered nothing to change.
 */
export function GroupUserDrawer({ groupId, groupName, api, platform = true }: { groupId: string; groupName: string; api: Api; platform?: boolean }) {
  const params = useSearchParams();
  const userId = params.get("user");
  const [lastId, setLastId] = React.useState<string | null>(userId);
  React.useEffect(() => { if (userId) setLastId(userId); }, [userId]);
  // Keep rendering the last person while the drawer slides shut.
  const shown = userId ?? lastId;
  if (!shown) return null;
  return <DrawerBody key={shown} open={Boolean(userId)} userId={shown} groupId={groupId} groupName={groupName} api={api} platform={platform} />;
}

function DrawerBody({ open, userId, groupId, groupName, api, platform }: { open: boolean; userId: string; groupId: string; groupName: string; api: Api; platform: boolean }) {
  const t = useTranslations("adminOrgs");
  const router = useRouter();
  const toast = useToast();
  const { close: closeGroupUser } = useGroupUserNav();
  const [load, setLoad] = React.useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = React.useState(0);
  const [dialog, setDialog] = React.useState<"access" | "suspend" | "remove" | { direct: GroupUserCompanyRow } | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<GroupRemovalPreview | null>(null);
  const [alsoDirect, setAlsoDirect] = React.useState(false);
  const [more, setMore] = React.useState<{ rows: GroupUserActivityRow[]; next: string | null } | null>(null);

  const refetch = React.useCallback(() => setAttempt((value) => value + 1), []);

  React.useEffect(() => {
    const controller = new AbortController();
    engineeringApi<GroupUserDetail>(api.command, { body: { action: "group.user.detail", groupId, userId }, signal: controller.signal })
      .then((detail) => { setLoad({ state: "ready", detail }); setMore(null); })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        const message = failureMessage(failure, "");
        // A person removed or never in this group reads the same: nothing to show (§97, §119).
        setLoad(/not found|no longer|not authorized|forbidden/i.test(message) || message === "" ? { state: "gone", message: t("groupUser.gone", { group: groupName }) } : { state: "error", message });
      });
    return () => controller.abort();
  }, [api.command, groupId, userId, attempt, groupName, t]);

  const detail = load.state === "ready" ? load.detail : null;
  const name = detail?.user.name ?? "";

  async function act(body: Record<string, unknown>, success: string, after?: () => void) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await engineeringApi(api.command, { body: { groupId, userId, ...body } });
      toast({ title: success, tone: "success" });
      setDialog(null);
      after?.();
      refetch();
      router.refresh();
    } catch (failure) {
      setError(`${failureMessage(failure)} ${t("users.member.noChanges")}`);
    } finally {
      setPending(false);
    }
  }

  async function startRemove() {
    setError(null); setAlsoDirect(false); setPreview(null); setDialog("remove");
    try {
      setPreview(await engineeringApi<GroupRemovalPreview>(api.command, { body: { action: "group.user.removePreview", groupId, userId } }));
    } catch (failure) {
      setError(failureMessage(failure));
    }
  }

  async function loadMore() {
    if (!detail) return;
    const cursor = more ? more.next : detail.activity.nextCursor;
    if (!cursor) return;
    try {
      const page = await engineeringApi<{ rows: GroupUserActivityRow[]; nextCursor: string | null }>(api.command, { body: { action: "group.user.activity", groupId, userId, cursor } });
      setMore({ rows: [...(more?.rows ?? []), ...page.rows], next: page.nextCursor });
    } catch (failure) {
      toast({ title: failureMessage(failure), tone: "danger" });
    }
  }

  const suspended = detail?.seatStatus === "SUSPENDED";
  const removed = detail ? detail.seatStatus !== "ACTIVE" && !suspended : false;
  const activity = detail ? [...detail.activity.rows, ...(more?.rows ?? [])] : [];
  const nextCursor = more ? more.next : detail?.activity.nextCursor ?? null;
  const access = detail?.companyAccess;

  return (
    <>
      <Drawer open={open} onOpenChange={(next) => { if (!next) closeGroupUser(); }}>
        <DrawerContent
          side="right"
          className="max-sm:w-full max-sm:max-w-none sm:max-w-[520px]"
          onCloseAutoFocus={(event) => {
            const opener = document.querySelector<HTMLElement>(`[data-group-user="${CSS.escape(userId)}"]`);
            if (opener) { event.preventDefault(); opener.focus(); }
          }}
          data-testid="group-user-drawer"
          aria-describedby="group-user-desc"
        >
          <header className="space-y-1 border-b border-line px-5 py-4">
            <DrawerTitle className="text-card font-semibold text-fg">{detail ? name : load.state === "loading" ? t("groupUser.loading") : t("groupUser.title")}</DrawerTitle>
            <DrawerDescription id="group-user-desc" className="text-table text-fg-muted">
              {detail ? (detail.roleName ? detail.roleName : t("groupUsers.seatOnly")) : groupName}
            </DrawerDescription>
            {detail ? (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <AdminStatusBadge status={detail.accountStatus !== "ACTIVE" ? detail.accountStatus : detail.seatStatus} />
                <span className="font-mono text-micro text-fg-subtle">{detail.user.email ?? detail.user.username}</span>
              </div>
            ) : null}
          </header>

          <div className="flex-1 space-y-6 px-5 py-4" aria-live="polite">
            {load.state === "loading" ? (
              <div className="space-y-3" role="status" aria-label={t("groupUser.loading")}><Skeleton className="h-5 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>
            ) : load.state === "gone" ? (
              <div className="space-y-3"><p className="text-table text-fg" role="alert">{load.message}</p><Button variant="secondary" onClick={closeGroupUser}>{t("groupUser.close")}</Button></div>
            ) : load.state === "error" ? (
              <div className="space-y-3"><p className="text-table text-danger" role="alert">{t("groupUser.loadFailed")} {load.message}</p><Button variant="secondary" onClick={() => { setLoad({ state: "loading" }); refetch(); }}>{t("groupUser.tryAgain")}</Button></div>
            ) : detail && access ? (
              <>
                {detail.accountStatus !== "ACTIVE" ? <p role="alert" className="rounded-lg border border-line bg-warning-soft p-2.5 text-table text-fg">{t("groupUser.accountSuspended", { name })}</p> : null}
                {suspended ? <p role="status" className="rounded-lg border border-line bg-warning-soft p-2.5 text-table text-fg">{t("groupUser.accessSuspendedNote", { name })}</p> : null}
                {removed ? <p role="status" className="rounded-lg border border-line p-2.5 text-table text-fg-muted">{t("groupUser.removedNote", { name, group: groupName })}</p> : null}

                <section aria-labelledby="gu-overview" className="space-y-2">
                  <h2 id="gu-overview" className="text-meta font-semibold uppercase tracking-wide text-fg-subtle">{t("groupUser.groupAccess")}</h2>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-table">
                    <dt className="text-fg-subtle">{t("groupUser.group")}</dt><dd className="text-fg">{groupName}</dd>
                    <dt className="text-fg-subtle">{t("groupUser.groupRole")}</dt><dd className="text-fg">{detail.roleName ?? t("groupUsers.seatOnly")}</dd>
                    <dt className="text-fg-subtle">{t("groupUser.groupAccessStatus")}</dt><dd><AdminStatusBadge status={detail.seatStatus} /></dd>
                    {detail.department ? (<><dt className="text-fg-subtle">{t("groupUser.department")}</dt><dd className="text-fg">{detail.department}</dd></>) : null}
                    {detail.joinedAt ? (<><dt className="text-fg-subtle">{t("groupUser.joined")}</dt><dd className="text-fg">{dateFormat(detail.joinedAt)}</dd></>) : null}
                  </dl>
                  {detail.groupWide ? <p className="text-table text-fg-muted">{t("groupUsers.accessGroupWide")}</p> : null}
                </section>

                <section aria-labelledby="gu-companies" className="space-y-2" data-testid="group-user-companies">
                  <div className="flex items-center justify-between gap-2">
                    <h2 id="gu-companies" className="text-meta font-semibold uppercase tracking-wide text-fg-subtle">{t("groupUser.companyAccess")}</h2>
                    {detail.can.manage && detail.seatStatus === "ACTIVE" ? <Button size="sm" variant="ghost" onClick={() => { setError(null); setDialog("access"); }}>{t("groupUser.editScope")}</Button> : null}
                  </div>
                  <p className="text-table text-fg">
                    {access.mode === "ALL" ? t("groupUser.scopeAll", { count: access.total }) : access.mode === "SELECTED" ? t("groupUser.scopeSelected", { count: access.total }) : detail.groupWide ? t("groupUsers.accessGroupWide") : t("groupUser.scopeNone")}
                  </p>
                  {access.companies.length === 0 ? (
                    <p className="text-table text-fg-muted">{t("groupUser.noCompaniesBody", { name })}</p>
                  ) : (
                    <ul className="divide-y divide-line rounded-lg border border-line">
                      {access.companies.map((row) => (
                        <li key={row.companyId} className="flex items-start justify-between gap-2 px-3 py-2" data-testid="group-user-company" data-source={row.source}>
                          <div className="min-w-0">
                            <p className="truncate text-table font-medium text-fg">{row.companyName}</p>
                            <p className="text-meta text-fg-muted">{row.source === "GROUP_DERIVED" ? (row.groupRole ?? "") : row.directRole}</p>
                            <p className="text-meta text-fg-subtle">{row.source === "BOTH" ? t("groupUser.sourceBoth") : row.source === "GROUP_DERIVED" ? t("groupUser.sourceGroup", { group: groupName }) : t("groupUser.sourceDirect")}</p>
                          </div>
                          {detail.can.manage && row.directRole ? (
                            <Button size="sm" variant="ghost" onClick={() => { setError(null); setDialog({ direct: row }); }}>{t("groupUser.removeDirect")}</Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                  {access.total > access.companies.length ? <p className="text-meta text-fg-subtle">{t("groupUser.showing", { shown: access.companies.length, total: access.total })}</p> : null}
                </section>

                <section aria-labelledby="gu-projects" className="space-y-2" data-testid="group-user-projects">
                  <h2 id="gu-projects" className="text-meta font-semibold uppercase tracking-wide text-fg-subtle">{t("groupUser.projectAccess")}{detail.projects.total ? ` · ${detail.projects.total}` : ""}</h2>
                  {detail.projects.rows.length === 0 ? <p className="text-table text-fg-muted">{t("groupUser.noProjects")}</p> : (
                    <ul className="divide-y divide-line rounded-lg border border-line">
                      {detail.projects.rows.map((row) => (
                        <li key={`${row.projectId}-${row.companyId}`} className="px-3 py-2">
                          <p className="text-table font-medium text-fg">{row.projectName}</p>
                          <p className="text-meta text-fg-muted">{row.role} · {row.companyName}</p>
                          <p className="text-meta text-fg-subtle">{row.source === "VIA_GROUP" ? t("groupUser.projectViaGroup") : t("groupUser.projectDirect")}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                  {detail.projects.total > detail.projects.rows.length ? <p className="text-meta text-fg-subtle">{t("groupUser.showing", { shown: detail.projects.rows.length, total: detail.projects.total })}</p> : null}
                </section>

                <section aria-labelledby="gu-activity" className="space-y-2" data-testid="group-user-activity">
                  <h2 id="gu-activity" className="text-meta font-semibold uppercase tracking-wide text-fg-subtle">{t("groupUser.activity")}</h2>
                  {activity.length === 0 ? <p className="text-table text-fg-muted">{t("groupUser.noActivity")}</p> : (
                    <ul className="divide-y divide-line">
                      {activity.map((row) => (
                        <li key={row.id} className="py-2">
                          <p className="text-table text-fg">{t(`groupUser.act.${row.actionKey as ActionKey}`)}{row.detail ? <span className="text-fg-muted"> · {row.detail}</span> : null}</p>
                          <p className="text-meta text-fg-subtle">{dateTimeFormat(row.occurredAt)}{row.actorName ? ` · ${row.actorName}` : ""}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                  {nextCursor ? <Button size="sm" variant="ghost" onClick={loadMore}>{t("groupUser.loadMore")}</Button> : null}
                </section>
              </>
            ) : null}
          </div>

          {detail ? (
            <footer className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-line bg-sidebar px-5 py-3">
              <Button variant="ghost" onClick={closeGroupUser}>{t("groupUser.close")}</Button>
              <div className="flex items-center gap-2">
                {detail.can.manage && detail.seatStatus === "ACTIVE" ? <Button onClick={() => { setError(null); setDialog("access"); }} data-testid="group-user-edit-access">{t("groupUsers.editAccess")}</Button> : null}
                {detail.can.manage && suspended ? <Button disabled={pending} onClick={() => act({ action: "group.user.reactivate" }, t("groupUser.reactivated", { name }))}>{t("groupUser.reactivate")}</Button> : null}
                {(detail.can.manage && !removed) || (platform) ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button type="button" variant="ghost" aria-label={t("groupUser.more")} data-testid="group-user-more"><MoreHorizontal aria-hidden="true" className="size-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {detail.can.manage && detail.seatStatus === "ACTIVE" ? <DropdownMenuItem onSelect={() => { setError(null); setDialog("suspend"); }}>{t("groupUser.suspend")}</DropdownMenuItem> : null}
                      {detail.can.manage && !removed ? <DropdownMenuItem onSelect={() => void startRemove()} className="text-danger">{t("groupUsers.removeFromGroup")}</DropdownMenuItem> : null}
                      {platform ? (
                        <>
                          {detail.can.manage && !removed ? <DropdownMenuSeparator /> : null}
                          <DropdownMenuItem asChild><Link href={`/admin/users/${detail.user.id}?from=${groupId}`}>{t("groupUser.viewPlatformAccount")}</Link></DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            </footer>
          ) : null}
        </DrawerContent>
      </Drawer>

      {detail ? (
        <>
          <EditCompanyAccessDialog open={dialog === "access"} onOpenChange={(next) => { setDialog(next ? "access" : null); if (!next) refetch(); }} groupId={groupId} groupName={groupName} api={api} person={{ userId, name }} />
          <Dialog open={dialog === "suspend" || dialog === "remove" || (typeof dialog === "object" && dialog !== null)} locked={pending} onOpenChange={(next) => !next && setDialog(null)}>
            <DialogContent className="max-w-md" data-testid="group-user-dialog">
              {dialog === "suspend" ? (
                <>
                  <DialogTitle>{t("groupUser.suspendTitle", { name, group: groupName })}</DialogTitle>
                  <DialogDescription>{t("groupUser.suspendBody", { name })}</DialogDescription>
                </>
              ) : dialog === "remove" ? (
                <>
                  <DialogTitle>{t("groupUsers.removeTitle", { name, group: groupName })}</DialogTitle>
                  <DialogDescription>{t("groupUser.removeLose", { name })}</DialogDescription>
                  {preview ? (
                    <div className="space-y-3 text-table text-fg" data-testid="group-user-remove-preview">
                      <ul className="list-disc space-y-1 pl-5">
                        {preview.roleName ? <li>{t("groupUser.loseRole", { role: preview.roleName })}</li> : null}
                        <li>{t("groupUser.loseCompanies", { count: preview.lostCompanies.length })}</li>
                        <li>{t("groupUser.loseProjects", { count: preview.projectsLost })}</li>
                      </ul>
                      {preview.directCompanies.length > 0 ? (
                        <div><p className="font-medium">{t("groupUser.directRemain")}</p><ul className="list-disc pl-5">{preview.directCompanies.map((row) => <li key={row.name}>{row.name} — {row.role}</li>)}</ul><p className="text-meta text-fg-muted">{t("groupUser.directRemainNote")}</p></div>
                      ) : null}
                      {preview.blocked ? <p role="alert" className="text-danger">{preview.blocked === "SELF" ? t("groupUser.blockedSelf") : t("groupUser.blockedLastAdmin", { name, group: groupName })}</p> : null}
                      {preview.directCompanies.length > 0 && !preview.blocked ? <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={alsoDirect} onChange={(event) => setAlsoDirect(event.target.checked)} />{t("groupUsers.alsoCompanies")}</label> : null}
                    </div>
                  ) : !error ? <Skeleton className="mt-3 h-24 w-full" /> : null}
                </>
              ) : typeof dialog === "object" && dialog ? (
                <>
                  <DialogTitle>{t("groupUser.removeDirectTitle", { company: dialog.direct.companyName })}</DialogTitle>
                  <DialogDescription>
                    {dialog.direct.source === "BOTH"
                      ? t("groupUser.removeDirectKeep", { name, role: dialog.direct.directRole ?? "", company: dialog.direct.companyName, group: groupName, groupRole: dialog.direct.groupRole ?? "" })
                      : t("groupUser.removeDirectLose", { name, company: dialog.direct.companyName })}
                  </DialogDescription>
                </>
              ) : null}
              {error ? <p role="alert" className="mt-3 text-table text-danger">{error}</p> : null}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setDialog(null)} disabled={pending}>{t("users.member.cancel")}</Button>
                {dialog === "suspend" ? <Button variant="danger" disabled={pending} onClick={() => act({ action: "group.user.suspend" }, t("groupUser.suspended", { name }))}>{t("groupUser.suspendConfirm")}</Button> : null}
                {dialog === "remove" ? <Button variant="danger" disabled={pending || !preview || preview.blocked !== null} onClick={() => act({ action: "group.user.remove", alsoRemoveCompanyAccess: alsoDirect }, t("groupUsers.removed", { group: groupName }), closeGroupUser)}>{t("groupUsers.removeFromGroup")}</Button> : null}
                {typeof dialog === "object" && dialog ? <Button variant="danger" disabled={pending} onClick={() => act({ action: "group.user.removeDirect", companyId: dialog.direct.companyId }, t("groupUser.directRemoved", { company: dialog.direct.companyName }))}>{t("groupUser.removeDirectConfirm")}</Button> : null}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </>
  );
}
