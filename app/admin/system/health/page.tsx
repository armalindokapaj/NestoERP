import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { platformHealth } from "@/lib/modules/platform/platform-control.query";
export const metadata = { title: "System Health" };
export default async function HealthPage() { const context = await requirePlatformContext(); const health = await platformHealth(context); const tone = (state: string) => state === "HEALTHY" ? "success" as const : state === "DOWN" ? "danger" as const : "warning" as const; return <div className="space-y-5"><PageHeader title="System health" description="Application-level health from the services NESTO can verify directly." /><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{health.map((item) => <Card key={item.service} className="p-5"><div className="flex items-center justify-between"><h2 className="text-body font-semibold text-fg">{item.service}</h2><Badge tone={tone(item.state)}>{item.state}</Badge></div><p className="mt-4 text-table text-fg-muted">{item.detail}</p></Card>)}</div></div>; }
