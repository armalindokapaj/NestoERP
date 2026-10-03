import Link from "@/components/navigation/nav-link";

import { prisma } from "@/lib/database/prisma";
import { getTranslations } from "@/lib/i18n/server";

/**
 * Shown on every page of every sign-in until the person replaces the default
 * password they were issued. Reads the flag fresh each render, so it goes away
 * the moment the password is changed.
 */
export async function PasswordChangeNotice({ userId, href }: { userId: string; href: string }) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { mustChangePassword: true } });
  if (!user?.mustChangePassword) return null;
  const t = await getTranslations("adminAccess");
  return (
    <div role="alert" data-testid="password-change-notice" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-warning-soft px-4 py-3">
      <div>
        <p className="text-table font-semibold text-fg">{t("passwordNotice.title")}</p>
        <p className="text-table text-fg-muted">{t("passwordNotice.body")}</p>
      </div>
      <Link href={href} className="inline-flex h-9 items-center rounded-lg bg-accent px-3 text-table font-medium text-accent-fg hover:opacity-90">{t("passwordNotice.action")}</Link>
    </div>
  );
}
