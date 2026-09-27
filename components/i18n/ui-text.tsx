"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import type { MessageKey, MessageValues } from "@/lib/i18n/translator";

export type UiKey = MessageKey<"ui">;

/**
 * A shared-UI string in the reader's language, for components that render on
 * both the server and the client and so can neither await nor call hooks.
 */
export function UiText({ k, values }: { k: UiKey; values?: MessageValues }) {
  return <>{useTranslations("ui")(k, values)}</>;
}

/** A `<nav>` whose accessible name is a shared-UI string. */
export function UiNav({ k, ...props }: Omit<React.ComponentProps<"nav">, "aria-label"> & { k: UiKey }) {
  return <nav aria-label={useTranslations("ui")(k)} {...props} />;
}
