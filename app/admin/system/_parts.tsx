import type { ReactNode } from "react";

import { AdminStatusBadge } from "@/components/platform/admin-status-badge";

/** A labelled read-only fact on a System page. Secrets are shown as "Configured", never their value (Admin System PRD #6 §51, §59). */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt className="text-meta text-fg-subtle">{label}</dt><dd className="text-body text-fg">{children}</dd></div>;
}

export function Status({ value }: { value: string }) {
  return <AdminStatusBadge status={value} />;
}
