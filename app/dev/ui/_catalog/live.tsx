"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Bold, ImageOff, Star } from "@/components/icons";

import { useLocale } from "@/components/i18n/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { IconButton } from "@/components/ui/icon-button";
import { SearchField } from "@/components/ui/search-field";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";
import { formatCurrency } from "@/lib/i18n/format";

/*
 * The catalog's live specimens: the states that only exist while something is
 * happening — a button that is busy, a toggle that is pressed, a row that is
 * selected. Each is the real primitive with a few lines of state around it.
 */

/** A button that stays busy. A busy button carries a handler, so it is rendered from a client file (button.tsx). */
export function BusyButton(props: Omit<ButtonProps, "loading">) {
  return <Button loading {...props} />;
}

/**
 * Activate it, then keep pressing Enter: it works once, keeps its width and
 * keeps focus, and the counts below say what it accepted and what it refused
 * (UI-02 §10.1).
 */
export function SaveDemo() {
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState(0);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  function save() {
    setBusy(true);
    timer.current = setTimeout(() => {
      setBusy(false);
      setSaved((count) => count + 1);
    }, 2500);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={save} loading={busy} data-testid="catalog-save">Save changes</Button>
      <p role="status" className="text-meta text-fg-muted" data-testid="catalog-save-count">
        {saved === 0 ? "Not saved yet." : `Saved ${saved} ${saved === 1 ? "time" : "times"}.`}
      </p>
    </div>
  );
}

/** Two toggles: `aria-pressed`, and a ring that stays under hover. */
export function PressedDemo() {
  const [bold, setBold] = React.useState(true);
  const [starred, setStarred] = React.useState(false);
  return (
    <div className="flex items-center gap-2">
      <IconButton label="Bold" icon={<Bold aria-hidden="true" />} pressed={bold} onClick={() => setBold((on) => !on)} />
      <IconButton label="Add to favourites" icon={<Star aria-hidden="true" />} pressed={starred} onClick={() => setStarred((on) => !on)} />
    </div>
  );
}

const DISCIPLINES = ["Structural", "Mechanical, electrical and plumbing", "Facade", "Fit-out"];

/** Removable tags: each remove button is named after its tag, and focus moves to a neighbour when one goes. */
export function RemovableTags() {
  const [tags, setTags] = React.useState(DISCIPLINES);
  const list = React.useRef<HTMLUListElement>(null);

  function remove(tag: string) {
    const index = tags.indexOf(tag);
    setTags((current) => current.filter((entry) => entry !== tag));
    // After the list has re-rendered: the tag that took this one's place, or the one before it.
    requestAnimationFrame(() => {
      const buttons = list.current?.querySelectorAll<HTMLButtonElement>("button");
      (buttons?.[Math.min(index, (buttons?.length ?? 1) - 1)] ?? list.current)?.focus();
    });
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3">
      <ul ref={list} tabIndex={-1} aria-label="Disciplines" className="flex min-w-0 flex-wrap gap-2">
        {tags.map((tag) => (
          <li key={tag} className="min-w-0">
            <Tag onRemove={() => remove(tag)} removeLabel={`Remove ${tag}`}>{tag}</Tag>
          </li>
        ))}
      </ul>
      {tags.length < DISCIPLINES.length ? (
        <Button variant="ghost" size="sm" onClick={() => setTags(DISCIPLINES)}>Restore all</Button>
      ) : null}
    </div>
  );
}

type Invoice = { id: string; supplier: string; status: "Approved" | "In review" | "Overdue" | "Rejected" | "Archived"; due: string; amount: number; paid: number };

const INVOICES: Invoice[] = [
  { id: "INV-2041", supplier: "Alba Concrete", status: "Approved", due: "12 Oct 2026", amount: 128450, paid: 100 },
  { id: "INV-2042", supplier: "Durres Steel and Reinforcement Works, Northern Depot", status: "In review", due: "19 Oct 2026", amount: 1284500, paid: 40 },
  { id: "INV-2043", supplier: "Tirana Glazing", status: "Overdue", due: "30 Sep 2026", amount: 9870, paid: 0 },
  { id: "INV-2044", supplier: "Vlora Electrical", status: "Rejected", due: "02 Nov 2026", amount: 45200, paid: 0 },
  { id: "INV-1987", supplier: "Shkodra Timber", status: "Archived", due: "14 Mar 2026", amount: 3120, paid: 100 },
];

const TONES = { Approved: "success", "In review": "info", Overdue: "warning", Rejected: "danger", Archived: "neutral" } as const;

/**
 * A table doing what §12 asks of it: numeric columns right-aligned in tabular
 * numerals, a header that says how it is sorted, and rows whose checkbox
 * selects them — the selected cue stays while the pointer is over the row.
 */
export function InvoiceTable() {
  const locale = useLocale();
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(["INV-2042"]));
  const [direction, setDirection] = React.useState<"ascending" | "descending">("descending");
  const rows = [...INVOICES].sort((a, b) => (direction === "ascending" ? a.amount - b.amount : b.amount - a.amount));
  const all = selected.size === rows.length;

  function toggle(id: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const SortIcon = direction === "ascending" ? ArrowUp : ArrowDown;

  return (
    <Table label="Supplier invoices" data-testid="catalog-table">
      <TableHead>
        <tr>
          <TableHeaderCell scope="col" className="w-10">
            <Checkbox
              aria-label="Select all invoices"
              checked={all ? true : selected.size > 0 ? "indeterminate" : false}
              onCheckedChange={(on) => setSelected(on === true ? new Set(rows.map((row) => row.id)) : new Set())}
            />
          </TableHeaderCell>
          <TableHeaderCell scope="col">Invoice</TableHeaderCell>
          <TableHeaderCell scope="col">Supplier</TableHeaderCell>
          <TableHeaderCell scope="col">Status</TableHeaderCell>
          <TableHeaderCell scope="col">Due</TableHeaderCell>
          <TableHeaderCell scope="col" numeric sort={direction}>
            <button
              type="button"
              onClick={() => setDirection((current) => (current === "ascending" ? "descending" : "ascending"))}
              title="Sort by amount"
              className="-mx-1 inline-flex items-center gap-1 rounded px-1 font-mono uppercase tracking-[0.08em] text-fg transition-colors touch:min-h-11"
            >
              Amount
              <SortIcon aria-hidden="true" className="size-3.5" />
            </button>
          </TableHeaderCell>
          <TableHeaderCell scope="col" numeric sort="none">Paid</TableHeaderCell>
        </tr>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} selected={selected.has(row.id)} className={row.status === "Archived" ? "text-fg-muted" : undefined}>
            <TableCell className="w-10">
              <Checkbox aria-label={`Select ${row.id}`} checked={selected.has(row.id)} onCheckedChange={(on) => toggle(row.id, on === true)} />
            </TableCell>
            <TableCell className="whitespace-nowrap font-medium">
              <a href="#tables" className="text-accent-strong underline-offset-4 hover:underline">{row.id}</a>
            </TableCell>
            <TableCell className="max-w-64">{row.supplier}</TableCell>
            <TableCell><Badge tone={TONES[row.status]}>{row.status}</Badge></TableCell>
            <TableCell className="whitespace-nowrap">{row.due}</TableCell>
            <TableCell numeric className="whitespace-nowrap">{formatCurrency(row.amount, "EUR", locale)}</TableCell>
            <TableCell numeric>{row.paid}%</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** The search field with its clear control: Escape clears, then leaves the field. */
export function SearchDemo() {
  const [query, setQuery] = React.useState("reinforcement");
  return <SearchField aria-label="Search invoices" placeholder="Search invoices…" value={query} onChange={(event) => setQuery(event.target.value)} onClear={() => setQuery("")} />;
}

/** Bytes that are not a picture, so the broken-image card needs no request and fails the same way every time. */
const UNREADABLE = "data:image/png;base64,AAAA";

/**
 * A card's 16:9 picture whose file does not load (UI-02 §11.1). The image is
 * a real one that fails; when it does, the card keeps the picture's room and
 * says what is missing — never the browser's torn-page icon, never a
 * collapsed box. The failure may land before React attaches its handler, so
 * the image is asked once more when the component mounts.
 */
export function Picture({ alt }: { alt: string }) {
  const [broken, setBroken] = React.useState(false);
  const image = React.useRef<HTMLImageElement>(null);
  React.useEffect(() => {
    if (image.current?.complete && image.current.naturalWidth === 0) setBroken(true);
  }, []);

  return (
    <div className="grid aspect-video place-items-center overflow-hidden rounded-t-[inherit] border-b border-line bg-surface-muted text-fg-subtle" data-testid="catalog-broken-image">
      {broken ? (
        <span className="flex flex-col items-center gap-1 px-3 text-center text-meta"><ImageOff aria-hidden="true" className="size-6" />The image could not be loaded</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- a specimen of a picture that fails; nothing to optimise.
        <img ref={image} src={UNREADABLE} alt={alt} onError={() => setBroken(true)} className="size-full object-cover" />
      )}
    </div>
  );
}
