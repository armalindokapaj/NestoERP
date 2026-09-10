import type { Metadata } from "next";

import { PlaceholderModulePage } from "@/components/modules/placeholder-module-page";
import { modules } from "@/config/modules";

const MODULE_KEY = "support" as const;

export const metadata: Metadata = {
  title: modules[MODULE_KEY].label,
};

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  return <PlaceholderModulePage moduleKey={MODULE_KEY} searchParams={searchParams} />;
}
