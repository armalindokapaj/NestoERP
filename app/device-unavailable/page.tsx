import type { Metadata } from "next";

import { DeviceUnavailableActions } from "@/components/security/device-unavailable-actions";
import { getTranslations } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "NESTO" };

type Params = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Where a revoked, blocked or out-of-date installed app lands (MOB-11 §137,
 * §139, §187). Outside the application shell: there is no workspace to show. It
 * says what happened in plain words and offers the way out; no protected data
 * is loaded here.
 */
export default async function DeviceUnavailablePage({ searchParams }: Params) {
  const { reason } = await searchParams;
  const kind = reason === "blocked" ? "blocked" : reason === "update" ? "update" : "revoked";
  const t = await getTranslations("native");
  const title = kind === "update" ? t("securityUpdateTitle") : kind === "blocked" ? t("blockedTitle") : t("revokedTitle");
  const body = kind === "update" ? t("securityUpdateBody") : kind === "blocked" ? t("blockedBody") : t("revokedBody");
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas p-6" data-testid="device-unavailable" data-reason={kind}>
      <div className="flex max-w-sm flex-col items-stretch gap-3 text-center">
        <h1 className="text-lg font-semibold text-fg">{title}</h1>
        <p className="text-table text-fg-muted">{body}</p>
        <DeviceUnavailableActions update={kind === "update"} />
      </div>
    </main>
  );
}
