import { PlatformCommandButton } from "@/components/platform/platform-command";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { platformSettings } from "@/lib/modules/platform/platform-control.query";

export const metadata = { title: "Platform Settings" };
const settings = [
  ["general.platformName", "Platform name", "text"], ["general.platformUrl", "Platform URL", "text"], ["general.supportContact", "Support contact", "text"],
  ["localization.defaultLanguage", "Default language", "text"], ["localization.defaultCurrency", "Default currency", "text"], ["localization.defaultTimezone", "Default timezone", "text"],
  ["branding.logoUrl", "Logo URL", "text"], ["branding.faviconUrl", "Favicon URL", "text"],
] as const;
export default async function SettingsPage() { const context = await requirePlatformContext(); const data = await platformSettings(context); const groups = [{ title: "General", prefix: "general." }, { title: "Localization", prefix: "localization." }, { title: "Branding", prefix: "branding." }]; return <div className="space-y-5"><PageHeader title="Platform settings" description="Platform defaults remain separate from tenant configuration and branding." /><div className="grid gap-4 xl:grid-cols-3">{groups.map((group) => <Card key={group.title} className="p-5"><h2 className="text-card font-semibold text-fg">{group.title}</h2><div className="mt-4 divide-y divide-line">{settings.filter(([key]) => key.startsWith(group.prefix)).map(([key, label, type]) => <div key={key} className="flex items-center justify-between gap-4 py-3"><div><p className="text-table font-medium text-fg">{label}</p><p className="max-w-56 truncate font-mono text-meta text-fg-subtle">{String(data.values[key] ?? "—")}</p></div><PlatformCommandButton label="Edit" title={`Edit ${label.toLowerCase()}`} action="setting.save" fixed={{ key }} fields={[{ name: "value", label, type, required: true }, { name: "reason", label: "Reason", type: "textarea", required: true }]} initial={{ value: data.values[key] }} success="Platform setting saved." /></div>)}</div></Card>)}</div></div>; }
