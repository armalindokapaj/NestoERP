import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { systemOverview } from "@/lib/modules/platform/platform-system.service";
import { Fact, Status } from "../_parts";

export const metadata: Metadata = { title: "Authentication" };

/** How people sign in (Admin System PRD #6 §31-§33, §48, §49): one eight-hour session policy everywhere, read-only. */
export default async function AuthenticationPage() {
  const context = await requirePlatformContext();
  const { authentication } = await systemOverview(context);
  return (
    <div className="space-y-5">
      <PageHeader title="Authentication" description="Sign-in, sessions and password recovery across every NESTO workspace." />
      <section className="nesto-card p-5">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Session duration">{authentication.sessionHours} hours</Fact>
          <Fact label="Applies to">Platform Admin, Group, Company and Project workspaces</Fact>
          <Fact label="Authentication method">{authentication.method}</Fact>
          <Fact label="Password reset"><Status value={authentication.passwordReset === "Enabled" ? "Enabled" : "Disabled"} /> <span className="text-meta text-fg-subtle">{authentication.passwordReset === "Enabled" ? "by email link" : authentication.passwordReset}</span></Fact>
        </dl>
        <p className="mt-4 text-table text-fg-muted">A session ends after {authentication.sessionHours} hours, on sign-out, on Sign Out Everywhere, or when the account or its company is suspended. Reset links are single-use, expire, and sign out every session when used. {authentication.resetRequests7d} reset requests in the last 7 days.</p>
      </section>
    </div>
  );
}
