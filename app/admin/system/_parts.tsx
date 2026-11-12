import type { ReactNode } from "react";

import { AdminStatusBadge } from "@/components/platform/admin-status-badge";

/** A labelled read-only fact on a System page. Secrets are shown as "Configured", never their value (Admin System PRD #6 §51, §59). */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="nesto-eyebrow text-fg-subtle">{label}</dt><dd className="mt-0.5 text-body text-fg [overflow-wrap:anywhere]">{children}</dd></div>;
}

export function Status({ value }: { value: string }) {
  return <AdminStatusBadge status={value} />;
}
