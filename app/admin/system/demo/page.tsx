import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requirePlatformContext } from "@/lib/context/platform-context";

export const metadata = { title: "Demo / Development" };
export default async function DemoPage() { await requirePlatformContext(); return <div className="space-y-5"><PageHeader title="Demo / Development" description="Environment-gated tooling." /><Card className="p-6"><h2 className="text-card font-semibold text-fg">Seed operations</h2><p className="mt-2 text-table text-fg-muted">Reset and reseed remain CLI operations in V0.1 because they destroy tenant data. They are guarded by the existing development environment and explicit demo-seed flags.</p><code className="mt-4 block rounded-lg bg-fg p-4 text-table text-canvas">pnpm db:reset:demo</code></Card></div>; }
