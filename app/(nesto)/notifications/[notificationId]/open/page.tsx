import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ShieldQuestion } from "lucide-react";

import { AccessError } from "@/lib/access/guards";
import { requireUserContext } from "@/lib/context/current-user";
import { openNotification, type OpenedNotification } from "@/lib/core/notifications/notification.service";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notificationCenter");
  return { title: t("title") };
}

type Params = { params: Promise<{ notificationId: string }> };

/**
 * Follows a notification (PRD #38 §82).
 *
 * The record is authorised now, not when the notification was written. When
 * access has gone the page says so in the same words whatever the reason —
 * deleted, archived out of scope, module switched off, role changed — so the
 * answer reveals nothing about the record.
 */
export default async function OpenNotificationPage({ params }: Params) {
  const { notificationId } = await params;
  const context = await requireUserContext();

  let opened: OpenedNotification;
  try {
    opened = await openNotification(context, notificationId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if ("href" in opened) redirect(opened.href);

  const t = await getTranslations("notificationCenter");
  return (
    <div className="mx-auto max-w-lg py-10">
      <section className="nesto-card p-8 text-center" data-testid="notification-unavailable">
        <ShieldQuestion aria-hidden="true" className="mx-auto size-8 text-fg-subtle" />
        <h1 className="mt-4 text-section font-semibold text-fg">{t("unavailableTitle")}</h1>
        <p className="mt-2 text-body text-fg-muted">{t("unavailableBody")}</p>
        <Link href="/notifications" className="mt-6 inline-flex text-table font-medium text-accent-strong hover:underline">
          {t("back")}
        </Link>
      </section>
    </div>
  );
}
