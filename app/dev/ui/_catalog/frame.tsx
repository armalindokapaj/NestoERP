import * as React from "react";

import { cn } from "@/lib/utils/cn";

/**
 * The catalog's own furniture (UI-02 §26.2): a titled entry, the notes that
 * document it, and a labelled specimen. Everything shown inside a specimen is
 * the real primitive from components/ui — nothing here redraws one.
 */
export type EntryNotes = {
  /** What a caller passes, beyond the native element's own attributes. */
  props: string;
  /** The element or ARIA role it renders. */
  role: string;
  keyboard: string;
  /** What it tells its caller, and when. */
  events: string;
  /** Which state wins when two apply (§9). */
  precedence: string;
  /** What may sit inside it, and what may not. */
  nesting: string;
  /** What changes with the width, the pointer and the density. */
  responsive: string;
  /** Who holds its state and its data. */
  data: string;
  /** States of the §9 contract it does not have. */
  notApplicable: string;
  /** The misuse to avoid. */
  avoid: string;
};

const NOTE_LABELS: Array<[keyof EntryNotes, string]> = [
  ["props", "Props"],
  ["role", "Role"],
  ["keyboard", "Keyboard"],
  ["events", "Events"],
  ["precedence", "State precedence"],
  ["nesting", "Nesting"],
  ["responsive", "Responsive"],
  ["data", "Data ownership"],
  ["notApplicable", "Not applicable"],
  ["avoid", "Avoid"],
];

export function CatalogEntry({
  id,
  title,
  source,
  summary,
  notes,
  children,
}: {
  id: string;
  title: string;
  /** The file the primitive lives in. */
  source: string;
  summary: string;
  notes: EntryNotes;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="border-t border-line py-8 first-of-type:border-t-0 first-of-type:pt-0">
      <div className="grid gap-x-8 gap-y-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-section font-semibold text-fg">
            {title}
            {/* The entry's `id` is the section's own, on <section>; the registry's anchor is its heading. */}
          </h2>
          <p className="mt-1 font-mono text-meta text-fg-subtle [overflow-wrap:anywhere]">{source}</p>
          <p className="mt-3 text-body text-fg-muted">{summary}</p>
          <dl className="mt-4 space-y-2 text-meta">
            {NOTE_LABELS.map(([key, label]) => (
              <div key={key}>
                <dt className="font-semibold text-fg">{label}</dt>
                <dd className="text-fg-muted">{notes[key]}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="min-w-0 space-y-6">{children}</div>
      </div>
    </section>
  );
}

/** A group of specimens that belong together: one variant's states, one family's cards. */
export function SpecimenGroup({ title, hint, children, className }: { title: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="min-w-0">
      <h3 className="text-card font-semibold text-fg">{title}</h3>
      {hint ? <p className="mt-0.5 text-meta text-fg-muted">{hint}</p> : null}
      <div className={cn("mt-3 flex flex-wrap items-start gap-x-6 gap-y-4", className)}>{children}</div>
    </div>
  );
}

/** One state of one primitive, named. The name is a caption, not part of the specimen. */
export function Specimen({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <figure className={cn("min-w-0", className)}>
      <div className="flex min-h-11 items-center">{children}</div>
      <figcaption className="mt-1.5 text-meta text-fg-subtle">{label}</figcaption>
    </figure>
  );
}
