import type { Metadata } from "next";
import { Building2 } from "lucide-react";

import { NestoLogo } from "@/components/layout/nesto-logo";
import { SignOutButton } from "@/components/auth/sign-out-button";

export const metadata: Metadata = {
  title: "Workspace unavailable",
};

/**
 * Authenticated, but with no usable company context (PRD #6 §48, §49).
 *
 * Deliberately outside the application shell: the shell itself needs a resolved
 * context, and this page exists precisely because there isn't one. Nothing here
 * discloses account internals (PRD #6 §49).
 */
const MESSAGES: Record<string, { title: string; detail: string }> = {
  company: {
    title: "Company access unavailable",
    detail: "This workspace is currently unavailable. Contact your administrator.",
  },
  configuration: {
    title: "Unable to load your workspace",
    detail:
      "Your access configuration could not be read. Nothing has been granted by default — contact your administrator.",
  },
  default: {
    title: "Workspace unavailable",
    detail:
      "You currently don't have access to an active NESTO company workspace. Contact your administrator.",
  },
};

export default async function WorkspaceUnavailablePage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const message = MESSAGES[reason ?? "default"] ?? MESSAGES.default;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 text-center">
      <NestoLogo className="mb-8" />
      <div className="mx-auto mb-4 grid size-11 place-items-center rounded-full border border-line bg-surface text-fg-subtle">
        <Building2 className="size-5" />
      </div>
      <h1 className="text-section font-semibold text-fg">{message.title}</h1>
      <p className="mt-2 max-w-sm text-body text-fg-muted">{message.detail}</p>
      <SignOutButton className="mt-6" />
    </div>
  );
}
