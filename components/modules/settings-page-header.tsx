import { Breadcrumbs } from "@/components/ui/breadcrumbs";

/**
 * Header for a settings sub-page (design spec §64).
 * Settings sits two levels deep, which is exactly where §64 wants breadcrumbs.
 */
export function SettingsPageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <Breadcrumbs items={[{ label: "Settings", href: "/settings" }, { label: title }]} />
      <h1 className="mt-2 text-page font-semibold text-fg">{title}</h1>
      <p className="mt-1.5 text-body text-fg-muted">{description}</p>
    </div>
  );
}
