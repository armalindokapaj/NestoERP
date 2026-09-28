import type { Metadata } from "next";
import { Building2 } from "lucide-react";

import { NestoLogo } from "@/components/layout/nesto-logo";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("misc"))("unavailable.defaultTitle") };
}

/**
 * Authenticated, but with no usable company context (PRD #6 §48, §49).
 *
 * Deliberately outside the application shell: the shell itself needs a resolved
 * context, and this page exists precisely because there isn't one. Nothing here
 * discloses account internals (PRD #6 §49).
 */
const MESSAGES = {
  company: { title: "unavailable.companyTitle", detail: "unavailable.companyDetail" },
  configuration: { title: "unavailable.configurationTitle", detail: "unavailable.configurationDetail" },
  default: { title: "unavailable.defaultTitle", detail: "unavailable.defaultDetail" },
} as const;

export default async function WorkspaceUnavailablePage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const message = MESSAGES[(reason ?? "default") as keyof typeof MESSAGES] ?? MESSAGES.default;
  const m = await getTranslations("misc");

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 text-center">
      <NestoLogo className="mb-8" />
      <div className="mx-auto mb-4 grid size-11 place-items-center rounded-full border border-line bg-surface text-fg-subtle">
        <Building2 className="size-5" />
      </div>
      <h1 className="text-section font-semibold text-fg">{m(message.title)}</h1>
      <p className="mt-2 max-w-sm text-body text-fg-muted">{m(message.detail)}</p>
      <SignOutButton className="mt-6" />
    </div>
  );
}
