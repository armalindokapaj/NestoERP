import type { ReactNode } from "react";

/**
 * A whole-tab message inside the Experience Editor frame: missing Experience,
 * refused access, a renderer failure. Dark and full-bleed like the editor, and
 * with no Platform Admin chrome to fall back on (3D Editor PRD §85, §86, §156).
 * Links out are plain document navigations.
 */
export function EditorStateScreen({ code, title, children, actions }: { code?: string; title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <section className="max-w-md text-center">
        {code ? <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-fg-subtle">{code}</p> : null}
        <h1 className="mt-2 text-lg font-semibold text-fg">{title}</h1>
        <div className="mt-2 text-sm leading-6 text-fg-muted">{children}</div>
        {actions ? <div className="mt-6 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
      </section>
    </div>
  );
}
