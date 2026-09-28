"use client";

import { useCommonTranslations } from "@/components/i18n/common-text";
import type { MessageValues } from "@/lib/i18n/translator";

/** A Help string (the shared `common.help` branch), for the server-rendered Help entry. */
export function HelpText({ k, values }: { k: "help" | "helpFor"; values?: MessageValues }) {
  return <>{useCommonTranslations()(`help.${k}`, values)}</>;
}
