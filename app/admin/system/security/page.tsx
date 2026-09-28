import type { Metadata } from "next";

import Link from "@/components/navigation/nav-link";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { systemOverview } from "@/lib/modules/platform/platform-system.service";
import { Fact } from "../_parts";

export const metadata: Metadata = { title: "Security" };

/** A factual security summary (Admin System PRD #6 §58): no score, only what NESTO knows. */
export default async function SecurityPage() {
  const context = await requirePlatformContext();
  const { security, authentication, email } = await systemOverview(context);
  const unrecoverable = security.platformAdmins.filter((row) => !row.canRecover);
  return (
    <div className="space-y-5">
      <PageHeader title="Security" description="Platform Admin accounts, sessions and recent security events." />
      <section className="nesto-card p-5">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Session policy">{authentication.sessionHours} hours</Fact>
          <Fact label="Password reset email">{email.status === "Configured" ? "Available" : "Unavailable"}</Fact>
          <Fact label="Failed sign-ins (24 h)"><Link href="/admin/audit/failed-logins" className="text-accent-strong hover:underline">{security.failedLogins24h}</Link></Fact>
          <Fact label="Platform Admins">{security.platformAdmins.length}</Fact>
        </dl>
        {security.platformAdmins.length === 1 ? <p className="mt-4 text-table text-warning-strong">There is only one Platform Admin. It cannot be suspended until another exists.</p> : null}
        {unrecoverable.length ? <p className="mt-2 text-table text-warning-strong">{unrecoverable.map((row) => row.name).join(", ")} {unrecoverable.length === 1 ? "has" : "have"} no verified recovery email, so a forgotten password cannot be reset by email.</p> : null}
      </section>
      <section className="nesto-card divide-y divide-line" aria-label="Platform Admin accounts">
        {security.platformAdmins.map((row) => (
          <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <Link href={`/admin/users/${row.id}`} className="font-medium text-fg hover:underline">{row.name}<span className="ml-2 font-mono text-meta text-fg-subtle">{row.username}</span></Link>
            <span className="flex items-center gap-2"><span className="text-meta text-fg-subtle">{row.canRecover ? "Recovery email verified" : "No recovery email"}</span><AdminStatusBadge status={row.active ? "ACTIVE" : "SUSPENDED"} /></span>
          </div>
        ))}
      </section>
    </div>
  );
}
