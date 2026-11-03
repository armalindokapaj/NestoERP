import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { PageHeaderFrame } from "@/components/ui/page-header";
import { getTranslations } from "@/lib/i18n/server";

/**
 * Header for a settings sub-page (design spec §64).
 * Settings sits two levels deep, which is exactly where §64 wants breadcrumbs.
 *
 * It draws the block every page shares (`PageHeaderFrame`,
 * components/ui/page-header.tsx; UI-02 §7.2).
 */
export async function SettingsPageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  const t = await getTranslations("settings");

  return (
    <PageHeaderFrame
      kind="settings"
      lead={<Breadcrumbs items={[{ label: t("title"), href: "/settings" }, { label: title }]} />}
      title={title}
      subtitle={description}
    />
  );
}
