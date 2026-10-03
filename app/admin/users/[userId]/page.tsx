import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Link from "@/components/navigation/nav-link";
import { adminRoleName } from "@/components/platform/admin-roles";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { PlatformCommandButton } from "@/components/platform/platform-command";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { AccessError } from "@/lib/access/guards";
import { canPlatform, requirePlatformContext } from "@/lib/context/platform-context";
import { getPlatformUser, userActivity, userGrants, userSessions } from "@/lib/modules/platform/platform-users.query";
import { getTranslations } from "@/lib/i18n/server";
import { enumLabel } from "@/lib/i18n/modules/adminAccess/enum-label";
import { cn } from "@/lib/utils/cn";
import { formatDate, formatDateTime, formatRelativeTime } from "@/lib/utils/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminAccess");
  return { title: t("users.detail.metaTitle") };
}

type Props = { params: Promise<{ userId: string }>; searchParams: Promise<{ tab?: string; from?: string }> };
type Context = Awaited<ReturnType<typeof requirePlatformContext>>;
const TABS = ["overview", "access", "sessions", "security", "activity"] as const;

/**
 * One NESTO account (Admin Users PRD #6 §13-§15, §39-§44): who it is, its
 * access in layers, its sessions, its security controls and its account
 * history. Never a password, hash or token; never HR or salary data.
 */
export default async function PlatformUserPage({ params, searchParams }: Props) {
  const [{ userId }, { tab: rawTab, from }] = await Promise.all([params, searchParams]);
  const tr = await getTranslations("roles");
  const t = await getTranslations("adminAccess");
  const context = await requirePlatformContext();
  const user = await getPlatformUser(context, userId).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const tab = TABS.some((key) => key === rawTab) ? rawTab! : "overview";

  return (
    <div className="space-y-5">
      {/* Opened from an organization: the way back to it stays one click (Organization-Scoped PRD #7 §53). */}
      {(() => {
        const origin = from ? user.memberships.map((row) => row.company).concat(user.memberships.flatMap((row) => (row.group ? [row.group] : [])), user.groups).find((row) => row.id === from) : undefined;
        return origin ? <Link href={`/admin/organizations/${origin.id}?tab=users`} className="text-table text-fg-muted hover:text-fg" data-testid="return-to-organization">← {origin.name}</Link> : null;
      })()}
      <Breadcrumbs items={[{ label: t("users.detail.breadcrumbRoot"), href: "/admin/users" }, { label: user.name }]} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-page font-semibold text-fg">{user.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-body text-fg-muted">
            <span className="font-mono text-meta">{user.username}</span>
            {user.email ? <span>{user.email}</span> : null}
            <AdminStatusBadge status={user.status} />
            {user.platformAdmin ? <Badge tone="info">{t("users.detail.platformAdmin")}</Badge> : null}
          </div>
        </div>
      </header>
      <nav aria-label={t("users.detail.tabsLabel")} className="nesto-context-tabs overflow-x-auto" data-context-tabs>
        <ul className="border-b border-line flex min-w-max gap-1">
          {TABS.map((key) => <li key={key}><Link href={key === "overview" ? `/admin/users/${user.id}` : `/admin/users/${user.id}?tab=${key}`} scroll={false} aria-current={tab === key ? "page" : undefined} className={cn("-mb-px flex h-10 items-center border-b-2 px-3 text-table", tab === key ? "border-accent font-semibold text-fg" : "border-transparent text-fg-muted hover:text-fg")}>{t(`users.detail.tabs.${key}` as never)}</Link></li>)}
        </ul>
      </nav>

      {tab === "overview" ? (
        <section className="nesto-card p-5" aria-label={t("users.detail.overview.label")}>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {([
              [t("users.detail.overview.accountStatus"), <AdminStatusBadge key="s" status={user.status} />],
              [t("users.detail.overview.scope"), user.platformAdmin ? t("users.detail.overview.scopePlatform") : user.groups.length ? t("users.detail.overview.scopeGroup") : user.memberships.length ? t("users.detail.overview.scopeCompany") : t("users.detail.overview.scopeNone")],
              [t("users.detail.overview.parentGroups"), user.groups.map((group) => group.name).join(", ") || "—"],
              [t("users.detail.overview.companies"), user.memberships.filter((row) => row.status === "ACTIVE").map((row) => `${row.company.name} (${adminRoleName(tr, row.role)})`).join(", ") || "—"],
              [t("users.detail.overview.projects"), String(user.memberships.reduce((sum, row) => sum + row.projects.length, 0))],
              [t("users.detail.overview.employeeRecord"), user.employee ? t("users.detail.overview.linked") : t("users.detail.overview.accountOnly")],
              [t("users.detail.overview.created"), formatDate(user.createdAt)],
              [t("users.detail.overview.lastSignIn"), user.lastLoginAt ? formatDateTime(user.lastLoginAt) : t("common.never")],
            ] as const).map(([label, value], index) => <div key={index}><dt className="text-meta text-fg-subtle">{label}</dt><dd className="text-body text-fg">{value}</dd></div>)}
          </dl>
        </section>
      ) : null}

      {tab === "access" ? <AccessTab context={context} user={user} /> : null}
      {tab === "sessions" ? <SessionsTab context={context} userId={user.id} name={user.name} /> : null}
      {tab === "security" ? <SecurityTab context={context} user={user} /> : null}
      {tab === "activity" ? <ActivityTab context={context} userId={user.id} /> : null}
    </div>
  );
}

async function AccessTab({ context, user }: { context: Context; user: Awaited<ReturnType<typeof getPlatformUser>> }) {
  const tr = await getTranslations("roles");
  const t = await getTranslations("adminAccess");
  const grants = await userGrants(context, user.id);
  return (
    <div className="space-y-4">
      {user.platformAdmin ? <p className="nesto-card p-4 text-table text-fg">{t("users.detail.access.platformAdminNote")}</p> : null}
      {user.groups.map((group) => <p key={group.id} className="nesto-card p-4 text-table"><Link href={`/admin/organizations/${group.id}`} className="font-medium text-fg hover:underline">{group.name}</Link> <span className="text-fg-muted">· {t("users.detail.access.groupLevel")}</span> <AdminStatusBadge status={group.status} /></p>)}
      <section className="nesto-card overflow-hidden" aria-label={t("users.detail.access.membershipsLabel")}>
        <h2 className="border-b border-line px-5 py-3 text-card font-semibold text-fg">{t("users.detail.access.companiesHeading")}</h2>
        {user.memberships.length === 0 ? <p className="px-5 py-4 text-table text-fg-muted">{t("users.detail.access.noMembership")}</p> : (
          <ul className="divide-y divide-line">
            {user.memberships.map((row) => (
              <li key={row.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span><Link href={`/admin/organizations/${row.company.id}`} className="font-medium text-fg hover:underline">{row.company.name}</Link>{row.group ? <span className="text-fg-muted"> · {row.group.name}</span> : null}</span>
                  <span className="flex items-center gap-2 text-table text-fg-muted">{adminRoleName(tr, row.role)}{row.department ? ` · ${row.department}` : ""}<AdminStatusBadge status={row.status} /></span>
                </div>
                {row.projects.length ? <p className="mt-1 text-meta text-fg-subtle">{t("users.detail.access.projectsLine", { projects: row.projects.map((project) => `${project.name}${project.role ? ` (${project.role})` : ""}`).join(", ") })}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="nesto-card overflow-hidden" aria-label={t("users.detail.access.grantsLabel")}>
        <h2 className="border-b border-line px-5 py-3 text-card font-semibold text-fg">{t("users.detail.access.grantsHeading")}</h2>
        {grants.length === 0 ? <p className="px-5 py-4 text-table text-fg-muted">{t("users.detail.access.noGrants")}</p> : (
          <ul className="divide-y divide-line">{grants.map((row) => <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-table"><span className="text-fg">{t("users.detail.access.grantLine", { module: row.module === "All modules" ? t("users.detail.access.allModules") : row.module, level: enumLabel(t, "enums.accessLevelLower", row.level, row.level.toLowerCase()), scope: enumLabel(t, "enums.scopeLower", row.scope, row.scope.toLowerCase()), group: row.group })}</span><AdminStatusBadge status={row.active ? "ACTIVE" : "INACTIVE"} /></li>)}</ul>
        )}
      </section>
    </div>
  );
}

async function SessionsTab({ context, userId, name }: { context: Context; userId: string; name: string }) {
  const t = await getTranslations("adminAccess");
  const rows = await userSessions(context, userId);
  const live = rows.filter((row) => row.active);
  const canRevoke = canPlatform(context, "platform.session.revoke");
  return (
    <section className="nesto-card overflow-hidden" aria-label={t("users.detail.sessions.label")}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <p className="text-table text-fg-muted">{t("users.detail.sessions.active", { count: live.length })}</p>
        {canRevoke && live.length ? <PlatformCommandButton label={t("users.detail.sessions.signOutEverywhere")} title={t("users.detail.sessions.signOutTitle", { name })} description={t("users.detail.sessions.signOutDescription")} action="user.signOutEverywhere" fixed={{ userId }} reasonOnly destructive variant="danger" submitLabel={t("users.detail.sessions.signOutEverywhere")} success={t("users.detail.sessions.signOutSuccess")} /> : null}
      </div>
      {rows.length === 0 ? <EmptyState className="m-4" title={t("users.detail.sessions.empty")} /> : (
        <div className="overflow-x-auto">
          <Table stack aria-label={t("users.detail.sessions.label")}>
            <TableHead><TableRow><TableHeaderCell>{t("users.detail.sessions.cols.device")}</TableHeaderCell><TableHeaderCell className="max-md:hidden">{t("users.detail.sessions.cols.address")}</TableHeaderCell><TableHeaderCell className="max-lg:hidden">{t("users.detail.sessions.cols.workspace")}</TableHeaderCell><TableHeaderCell className="max-sm:hidden">{t("users.detail.sessions.cols.started")}</TableHeaderCell><TableHeaderCell>{t("users.detail.sessions.cols.lastActive")}</TableHeaderCell><TableHeaderCell className="max-sm:hidden">{t("users.detail.sessions.cols.expires")}</TableHeaderCell><TableHeaderCell>{t("users.detail.sessions.cols.status")}</TableHeaderCell><TableHeaderCell /></TableRow></TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-64 truncate" title={row.device ?? undefined}>{row.device ?? t("common.unknown")}</TableCell>
                  <TableCell className="font-mono text-meta max-md:hidden">{row.ipAddress ?? "—"}</TableCell>
                  <TableCell className="max-lg:hidden">{row.workspace}</TableCell>
                  <TableCell className="max-sm:hidden">{formatDateTime(row.startedAt)}</TableCell>
                  <TableCell>{formatRelativeTime(row.lastActive)}</TableCell>
                  <TableCell className="max-sm:hidden">{formatDateTime(row.expiresAt)}</TableCell>
                  <TableCell><AdminStatusBadge status={row.active ? "ACTIVE" : "Expired"} /></TableCell>
                  <TableCell>{row.current ? <span className="text-meta text-fg-subtle">{t("users.detail.sessions.thisSession")}</span> : row.active && canRevoke ? <PlatformCommandButton label={t("common.revoke")} title={t("users.detail.sessions.revokeTitle")} action="session.revoke" fixed={{ sessionId: row.id }} reasonOnly destructive variant="danger" success={t("users.detail.sessions.revoked")} /> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

async function SecurityTab({ context, user }: { context: Context; user: Awaited<ReturnType<typeof getPlatformUser>> }) {
  const t = await getTranslations("adminAccess");
  const canManage = canPlatform(context, "platform.user.manage");
  const self = user.id === context.userId;
  return (
    <section className="nesto-card space-y-4 p-5" aria-label={t("users.detail.security.label")}>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-meta text-fg-subtle">{t("users.detail.security.authentication")}</dt><dd className="text-body text-fg">{t("users.detail.security.usernamePassword")}</dd></div>
        <div><dt className="text-meta text-fg-subtle">{t("users.detail.security.passwordChanged")}</dt><dd className="text-body text-fg">{formatDate(user.passwordChangedAt)}{user.mustChangePassword ? ` · ${t("users.detail.security.temporary")}` : ""}</dd></div>
        <div><dt className="text-meta text-fg-subtle">{t("users.detail.security.recoveryEmail")}</dt><dd className="text-body text-fg">{user.recoveryEmail ?? t("users.detail.security.notVerified")}</dd></div>
        <div><dt className="text-meta text-fg-subtle">{t("users.detail.security.account")}</dt><dd><AdminStatusBadge status={user.status} /></dd></div>
      </dl>
      {canManage ? (
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <PlatformCommandButton label={t("users.detail.security.sendReset")} title={t("users.detail.security.resetTitle", { name: user.name })} description={user.recoveryEmail ? t("users.detail.security.resetDescWith", { email: user.recoveryEmail }) : t("users.detail.security.resetDescWithout")} action="user.passwordReset" fixed={{ userId: user.id }} reasonOnly={false} fields={[]} submitLabel={t("users.detail.security.resetSubmit")} success={t("users.detail.security.resetSuccess")} />
          {self ? <span className="self-center text-meta text-fg-subtle">{t("users.detail.security.selfNote")}</span> : user.status === "ACTIVE" ? (
            <PlatformCommandButton label={t("users.detail.security.suspend")} title={t("users.detail.security.suspendTitle", { name: user.name })} description={`${t("users.detail.security.suspendDesc")}${user.platformAdmin ? ` ${t("users.detail.security.suspendLast")}` : ""}`} action="user.status" fixed={{ userId: user.id, status: "SUSPENDED" }} reasonOnly destructive variant="danger" submitLabel={t("users.detail.security.suspend")} success={t("users.detail.security.suspendSuccess")} />
          ) : (
            <PlatformCommandButton label={t("users.detail.security.reactivate")} title={t("users.detail.security.reactivateTitle", { name: user.name })} description={t("users.detail.security.reactivateDesc")} action="user.status" fixed={{ userId: user.id, status: "ACTIVE" }} reasonOnly submitLabel={t("users.detail.security.reactivate")} success={t("users.detail.security.reactivated")} />
          )}
        </div>
      ) : null}
    </section>
  );
}

async function ActivityTab({ context, userId }: { context: Context; userId: string }) {
  const t = await getTranslations("adminAccess");
  const rows = await userActivity(context, userId);
  return (
    <section className="nesto-card overflow-hidden" aria-label={t("users.detail.activity.label")}>
      {rows.length === 0 ? <p className="p-5 text-table text-fg-muted">{t("users.detail.activity.empty")}</p> : (
        <ul className="divide-y divide-line">
          {rows.map((row) => <li key={`${row.kind}:${row.id}`} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-2.5 text-table"><span className="text-fg">{row.label}{row.by ? <span className="text-fg-muted"> · {t("users.detail.activity.by", { name: row.by })}</span> : null}{row.detail ? <span className="text-fg-subtle"> · {row.detail}</span> : null}</span><time dateTime={row.at} title={formatDateTime(row.at)} className="text-meta text-fg-subtle">{formatRelativeTime(row.at)}</time></li>)}
        </ul>
      )}
    </section>
  );
}
