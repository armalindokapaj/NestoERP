"use client";

import { useCommonTranslations } from "@/components/i18n/common-text";

/** "Restricted user" / "Unknown" in the reader's language, wherever a PersonLink renders. */
export function PersonLinkText({ k }: { k: "restricted" | "unknown" }) {
  return <>{useCommonTranslations()(`person.${k}`)}</>;
}
