import type { Metadata } from "next";

import { OfflineApp } from "@/components/offline/workspace/offline-app";

export const metadata: Metadata = { title: "Offline workspace", robots: { index: false } };

/** Served from the device's copy when there is no network (MOB-09 §65). It reads only the local database. */
export default function OfflinePage() {
  return <OfflineApp />;
}
