"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { teamEn } from "@/lib/i18n/modules/team/en";
import { createTranslator, type MessageKey, type MessageValues, type Translate } from "@/lib/i18n/translator";

export type TeamKey = MessageKey<"team">;

/** Team's strings in English, for code that runs without a reader. */
export const englishTeam: Translate<"team"> = createTranslator("en", teamEn);

/**
 * `t` for Team's Client Components. Outside the Team boundary a string falls
 * back to English rather than showing its key.
 */
export function useTeamTranslations(): Translate<"team"> {
  const t = useTranslations("team");
  return React.useCallback<Translate<"team">>((key, values) => {
    const value = t(key, values);
    return value === key ? englishTeam(key, values) : value;
  }, [t]);
}

/** A Team string, for components that render on both the server and the client. */
export function TeamText({ k, values }: { k: TeamKey; values?: MessageValues }) {
  return <>{useTeamTranslations()(k, values)}</>;
}

/** Every English message the Team actions are known to return, back to its key. */
const SERVER_KEYS = new Map(Object.entries(teamEn.server).map(([key, text]) => [text, `server.${key}` as TeamKey]));

/**
 * A server action's message in the reader's language. The actions answer in
 * English; a message this module does not know passes through unchanged.
 */
export function useTeamServerText(): (message: string | undefined | null) => string | undefined {
  const t = useTeamTranslations();
  return React.useCallback(
    (message) => {
      if (!message) return undefined;
      const key = SERVER_KEYS.get(message);
      return key ? t(key) : message;
    },
    [t],
  );
}
