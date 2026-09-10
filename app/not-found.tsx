import Link from "next/link";

import { NestoLogo } from "@/components/layout/nesto-logo";
import { Button } from "@/components/ui/button";

/** 404 page (spec §57). */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 text-center">
      <NestoLogo className="mb-8" />
      <p className="text-micro font-semibold uppercase tracking-[0.18em] text-fg-subtle">404</p>
      <h1 className="mt-3 text-section font-semibold text-fg">Page not found.</h1>
      <p className="mt-2 max-w-sm text-body text-fg-muted">
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Button asChild>
          <Link href="/dashboard">Return to Dashboard</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/">Go to home page</Link>
        </Button>
      </div>
    </div>
  );
}
