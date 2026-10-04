import Link from "next/link";

/**
 * A Company-only share address seen by someone who may not open it (ADM-04A
 * §6): generic guidance and nothing about the organization behind it.
 */
export function PublicLoginRequired({ title, body, signIn, signInHref }: { title: string; body: string; signIn: string; signInHref: string | null }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-surface p-4">
      <div className="viewer-glass w-full max-w-sm rounded-panel p-5 text-center">
        <h1 className="text-sm font-semibold text-fg">{title}</h1>
        <p className="mt-1 text-xs text-fg/60">{body}</p>
        {signInHref ? (
          <Link href={signInHref} className="mt-4 inline-flex h-11 items-center justify-center rounded-control bg-accent px-5 text-[13px] font-semibold text-accent-fg hover:bg-accent">
            {signIn}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
