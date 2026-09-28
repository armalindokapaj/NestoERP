import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Link from "@/components/navigation/nav-link";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { PlatformCommandButton } from "@/components/platform/platform-command";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { AccessError } from "@/lib/access/guards";
import { canPlatform, requirePlatformContext } from "@/lib/context/platform-context";
import { getPlatformUser, userActivity, userGrants, userSessions } from "@/lib/modules/platform/platform-users.query";
import { cn } from "@/lib/utils/cn";
import { formatDate, formatDateTime, formatRelativeTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "User" };

type Props = { params: Promise<{ userId: string }>; searchParams: Promise<{ tab?: string }> };
type Context = Awaited<ReturnType<typeof requirePlatformContext>>;
const TABS = [["overview", "Overview"], ["access", "Access"], ["sessions", "Sessions"], ["security", "Security"], ["activity", "Activity"]] as const;

/**
 * One NESTO account (Admin Users PRD #6 §13-§15, §39-§44): who it is, its
 * access in layers, its sessions, its security controls and its account
 * history. Never a password, hash or token; never HR or salary data.
 */
export default async function PlatformUserPage({ params, searchParams }: Props) {
  const [{ userId }, { tab: rawTab }] = await Promise.all([params, searchParams]);
  const context = await requirePlatformContext();
  const user = await getPlatformUser(context, userId).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const tab = TABS.some(([key]) => key === rawTab) ? rawTab! : "overview";

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "Users", href: "/admin/users" }, { label: user.name }]} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-page font-semibold text-fg">{user.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-body text-fg-muted">
            <span className="font-mono text-meta">{user.username}</span>
            {user.email ? <span>{user.email}</span> : null}
            <AdminStatusBadge status={user.status} />
            {user.platformAdmin ? <Badge tone="info">Platform Admin</Badge> : null}
          </div>
        </div>
      </header>
      <nav aria-label="User sections" className="overflow-x-auto border-b border-line">
        <ul className="flex min-w-max gap-1">
          {TABS.map(([key, label]) => <li key={key}><Link href={key === "overview" ? `/admin/users/${user.id}` : `/admin/users/${user.id}?tab=${key}`} scroll={false} aria-current={tab === key ? "page" : undefined} className={cn("-mb-px flex h-10 items-center border-b-2 px-3 text-table", tab === key ? "border-accent font-semibold text-fg" : "border-transparent text-fg-muted hover:text-fg")}>{label}</Link></li>)}
        </ul>
      </nav>

      {tab === "overview" ? (
        <section className="nesto-card p-5" aria-label="Overview">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {([
              ["Account status", <AdminStatusBadge key="s" status={user.status} />],
              ["Scope", user.platformAdmin ? "Platform" : user.groups.length ? "Group" : user.memberships.length ? "Company" : "No access"],
              ["Parent Groups", user.groups.map((group) => group.name).join(", ") || "—"],
              ["Companies", user.memberships.filter((row) => row.status === "ACTIVE").map((row) => `${row.company.name} (${row.role})`).join(", ") || "—"],
              ["Projects", String(user.memberships.reduce((sum, row) => sum + row.projects.length, 0))],
              ["Employee record", user.employee ? "Linked" : "None — account only"],
              ["Created", formatDate(user.createdAt)],
              ["Last sign-in", user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Never"],
            ] as const).map(([label, value]) => <div key={label}><dt className="text-meta text-fg-subtle">{label}</dt><dd className="text-body text-fg">{value}</dd></div>)}
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
  const grants = await userGrants(context, user.id);
  return (
    <div className="space-y-4">
      {user.platformAdmin ? <p className="nesto-card p-4 text-table text-fg">Platform Admin — the NESTO control plane. It holds no company membership and no business permission follows from it.</p> : null}
      {user.groups.map((group) => <p key={group.id} className="nesto-card p-4 text-table"><Link href={`/admin/organizations/${group.id}`} className="font-medium text-fg hover:underline">{group.name}</Link> <span className="text-fg-muted">· Group level</span> <AdminStatusBadge status={group.status} /></p>)}
      <section className="nesto-card overflow-hidden" aria-label="Company memberships">
        <h2 className="border-b border-line px-5 py-3 text-card font-semibold text-fg">Companies</h2>
        {user.memberships.length === 0 ? <p className="px-5 py-4 text-table text-fg-muted">No company membership.</p> : (
          <ul className="divide-y divide-line">
            {user.memberships.map((row) => (
              <li key={row.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span><Link href={`/admin/organizations/${row.company.id}`} className="font-medium text-fg hover:underline">{row.company.name}</Link>{row.group ? <span className="text-fg-muted"> · {row.group.name}</span> : null}</span>
                  <span className="flex items-center gap-2 text-table text-fg-muted">{row.role}{row.department ? ` · ${row.department}` : ""}<AdminStatusBadge status={row.status} /></span>
                </div>
                {row.projects.length ? <p className="mt-1 text-meta text-fg-subtle">Projects: {row.projects.map((project) => `${project.name}${project.role ? ` (${project.role})` : ""}`).join(", ")}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="nesto-card overflow-hidden" aria-label="Access grants">
        <h2 className="border-b border-line px-5 py-3 text-card font-semibold text-fg">Grants</h2>
        {grants.length === 0 ? <p className="px-5 py-4 text-table text-fg-muted">No access grants beyond roles.</p> : (
          <ul className="divide-y divide-line">{grants.map((row) => <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-table"><span className="text-fg">{row.module} · {row.level.toLowerCase()} · {row.scope.toLowerCase()} in {row.group}</span><AdminStatusBadge status={row.active ? "ACTIVE" : "INACTIVE"} /></li>)}</ul>
        )}
      </section>
    </div>
  );
}

async function SessionsTab({ context, userId, name }: { context: Context; userId: string; name: string }) {
  const rows = await userSessions(context, userId);
  const live = rows.filter((row) => row.active);
  const canRevoke = canPlatform(context, "platform.session.revoke");
  return (
    <section className="nesto-card overflow-hidden" aria-label="Sessions">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <p className="text-table text-fg-muted">{live.length} active {live.length === 1 ? "session" : "sessions"}. Each lasts at most eight hours.</p>
        {canRevoke && live.length ? <PlatformCommandButton label="Sign Out Everywhere" title={`Sign ${name} out everywhere?`} description="Every session ends at once; the next request from any device must sign in again." action="user.signOutEverywhere" fixed={{ userId }} reasonOnly destructive variant="danger" submitLabel="Sign Out Everywhere" success="Signed out everywhere." /> : null}
      </div>
      {rows.length === 0 ? <EmptyState className="m-4" title="No sessions." /> : (
        <div className="overflow-x-auto">
          <Table flush aria-label="Sessions">
            <TableHead><TableRow><TableHeaderCell>Device / browser</TableHeaderCell><TableHeaderCell className="max-md:hidden">Address</TableHeaderCell><TableHeaderCell className="max-lg:hidden">Workspace</TableHeaderCell><TableHeaderCell className="max-sm:hidden">Started</TableHeaderCell><TableHeaderCell>Last active</TableHeaderCell><TableHeaderCell className="max-sm:hidden">Expires</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell /></TableRow></TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-64 truncate" title={row.device ?? undefined}>{row.device ?? "Unknown"}</TableCell>
                  <TableCell className="font-mono text-meta max-md:hidden">{row.ipAddress ?? "—"}</TableCell>
                  <TableCell className="max-lg:hidden">{row.workspace}</TableCell>
                  <TableCell className="max-sm:hidden">{formatDateTime(row.startedAt)}</TableCell>
                  <TableCell>{formatRelativeTime(row.lastActive)}</TableCell>
                  <TableCell className="max-sm:hidden">{formatDateTime(row.expiresAt)}</TableCell>
                  <TableCell><AdminStatusBadge status={row.active ? "ACTIVE" : "Expired"} /></TableCell>
                  <TableCell>{row.current ? <span className="text-meta text-fg-subtle">This session</span> : row.active && canRevoke ? <PlatformCommandButton label="Revoke" title="Revoke session" action="session.revoke" fixed={{ sessionId: row.id }} reasonOnly destructive variant="danger" success="Session revoked." /> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

function SecurityTab({ context, user }: { context: Context; user: Awaited<ReturnType<typeof getPlatformUser>> }) {
  const canManage = canPlatform(context, "platform.user.manage");
  const self = user.id === context.userId;
  return (
    <section className="nesto-card space-y-4 p-5" aria-label="Security">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-meta text-fg-subtle">Authentication</dt><dd className="text-body text-fg">Username and password</dd></div>
        <div><dt className="text-meta text-fg-subtle">Password last changed</dt><dd className="text-body text-fg">{formatDate(user.passwordChangedAt)}{user.mustChangePassword ? " · temporary" : ""}</dd></div>
        <div><dt className="text-meta text-fg-subtle">Recovery email</dt><dd className="text-body text-fg">{user.recoveryEmail ?? "Not verified"}</dd></div>
        <div><dt className="text-meta text-fg-subtle">Account</dt><dd><AdminStatusBadge status={user.status} /></dd></div>
      </dl>
      {canManage ? (
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <PlatformCommandButton label="Send Password Reset Email" title={`Send ${user.name} a reset link?`} description={user.recoveryEmail ? `A single-use link goes to ${user.recoveryEmail}. You never see or choose the password.` : "This account has no verified recovery email, so no link can be sent. The person adds one under My Account."} action="user.passwordReset" fixed={{ userId: user.id }} reasonOnly={false} fields={[]} submitLabel="Send Reset Email" success="Reset email sent." />
          {self ? <span className="self-center text-meta text-fg-subtle">Your own account is changed from My Account.</span> : user.status === "ACTIVE" ? (
            <PlatformCommandButton label="Suspend User" title={`Suspend ${user.name}?`} description={`The user will lose access to NESTO and every session ends. Their data and activity history remain.${user.platformAdmin ? " The last active Platform Admin cannot be suspended." : ""}`} action="user.status" fixed={{ userId: user.id, status: "SUSPENDED" }} reasonOnly destructive variant="danger" submitLabel="Suspend User" success="User suspended." />
          ) : (
            <PlatformCommandButton label="Reactivate" title={`Reactivate ${user.name}?`} description="They can sign in again with their existing memberships." action="user.status" fixed={{ userId: user.id, status: "ACTIVE" }} reasonOnly submitLabel="Reactivate" success="User reactivated." />
          )}
        </div>
      ) : null}
    </section>
  );
}

async function ActivityTab({ context, userId }: { context: Context; userId: string }) {
  const rows = await userActivity(context, userId);
  return (
    <section className="nesto-card overflow-hidden" aria-label="Activity">
      {rows.length === 0 ? <p className="p-5 text-table text-fg-muted">No account activity recorded.</p> : (
        <ul className="divide-y divide-line">
          {rows.map((row) => <li key={`${row.kind}:${row.id}`} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-2.5 text-table"><span className="text-fg">{row.label}{row.by ? <span className="text-fg-muted"> · by {row.by}</span> : null}{row.detail ? <span className="text-fg-subtle"> · {row.detail}</span> : null}</span><time dateTime={row.at} title={formatDateTime(row.at)} className="text-meta text-fg-subtle">{formatRelativeTime(row.at)}</time></li>)}
        </ul>
      )}
    </section>
  );
}
