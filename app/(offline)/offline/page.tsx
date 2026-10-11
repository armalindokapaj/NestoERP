import type { Metadata } from "next";

import { OfflineApp } from "@/components/offline/workspace/offline-app";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("offline"))("app.title"), robots: { index: false } };
}

/** Served from the device's copy when there is no network (MOB-09 §65). It reads only the local database. */
export default function OfflinePage() {
  return <OfflineApp />;
}
