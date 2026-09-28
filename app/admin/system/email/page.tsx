import type { Metadata } from "next";

import { PlatformCommandButton } from "@/components/platform/platform-command";
import { PageHeader } from "@/components/ui/page-header";
import { canPlatform, requirePlatformContext } from "@/lib/context/platform-context";
import { systemOverview } from "@/lib/modules/platform/platform-system.service";
import { formatDateTime } from "@/lib/utils/format";
import { Fact } from "../_parts";

export const metadata: Metadata = { title: "Email" };

/**
 * Email delivery (Admin System PRD #6 §50-§52): provider, status, sender and
 * the last test. The API key is shown as Configured, never its value; it is
 * changed in the deployment, not here.
 */
export default async function EmailPage() {
  const context = await requirePlatformContext();
  const { email } = await systemOverview(context);
  return (
    <div className="space-y-5">
      <PageHeader title="Email" description="Password reset, invitations and notifications depend on it." actions={canPlatform(context, "platform.settings.manage") ? <PlatformCommandButton label="Send Test Email" title="Send a test email" description="One message through the configured provider. The outcome is recorded here and in the audit log." action="system.testEmail" fields={[{ name: "to", label: "Send to", type: "email", required: true }]} submitLabel="Send" success="Test email handed to the provider." variant="primary" /> : undefined} />
      <section className="nesto-card p-5">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Provider">{email.provider}</Fact>
          <Fact label="Status"><span className={email.status === "Configured" ? "font-medium text-success-strong" : "font-medium text-warning-strong"}>{email.status}</span></Fact>
          <Fact label="Sender address">{email.sender ?? "Not set"}</Fact>
          <Fact label="API key">{email.apiKey}</Fact>
          <Fact label="Last test">{email.lastTest ? `${email.lastTest.status.toLowerCase()} · ${formatDateTime(email.lastTest.at)}${email.lastTest.errorCode ? ` · ${email.lastTest.errorCode}` : ""}` : "Never"}</Fact>
          <Fact label="Failed deliveries (7 days)">{email.failed7d}</Fact>
        </dl>
        {email.status !== "Configured" ? <p className="mt-4 text-table text-warning-strong">Email is not delivering to real inboxes. Password reset emails cannot reach users until MAIL_PROVIDER, MAIL_FROM and MAIL_API_KEY are set in the deployment.</p> : null}
      </section>
    </div>
  );
}
