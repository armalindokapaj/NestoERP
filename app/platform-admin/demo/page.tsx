import { Suspense } from "react";
import { DevUserSwitcher } from "@/components/layout/dev-user-switcher";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { isDevMode } from "@/lib/auth/dev-mode";
import { requirePlatformContext } from "@/lib/context/platform-context";

export const metadata = { title: "Demo / Development" };
export default async function DemoPage() { await requirePlatformContext(); return <div className="space-y-5"><PageHeader title="Demo / Development" description="Environment-gated tooling. User switching replaces the full authenticated session and loads the selected user's own context." /><Card className="p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><h2 className="text-card font-semibold text-fg">Full demo-user impersonation</h2><Badge tone={isDevMode ? "success" : "neutral"}>{isDevMode ? "AVAILABLE" : "DISABLED"}</Badge></div><p className="mt-2 max-w-2xl text-table text-fg-muted">The current session is revoked before the selected demo account is authenticated. Identity, role, memberships, scopes, projects, dashboard and navigation all come from that account.</p></div>{isDevMode ? <Suspense fallback={null}><DevUserSwitcher /></Suspense> : null}</div></Card><Card className="p-6"><h2 className="text-card font-semibold text-fg">Seed operations</h2><p className="mt-2 text-table text-fg-muted">Reset and reseed remain CLI operations in V0.1 because they destroy tenant data. They are guarded by the existing development environment and explicit demo-seed flags.</p><code className="mt-4 block rounded-lg bg-fg p-4 text-table text-canvas">pnpm db:reset:demo</code></Card></div>; }
