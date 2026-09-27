"use client";

import * as React from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { PersonAvatar } from "./meeting-ui";
import { useMeetingsTranslations } from "./meetings-text";

export type PickedPerson = { memberId: string; fullName: string; avatarUrl: string | null; jobTitle?: string | null };

/**
 * Find colleagues by name (PRD #40 §25). The list comes from the meetings
 * options endpoint — active members of this company only — so nobody from
 * another company can even be offered.
 */
export function PeoplePicker({
  id,
  exclude,
  onPick,
  placeholder,
  includeSelf = false,
}: {
  id: string;
  exclude: string[];
  onPick: (person: PickedPerson) => void;
  placeholder?: string;
  includeSelf?: boolean;
}) {
  const t = useMeetingsTranslations();
  const [query, setQuery] = React.useState("");
  const [people, setPeople] = React.useState<PickedPerson[]>([]);
  const [active, setActive] = React.useState(0);

  React.useEffect(() => {
    if (!query.trim()) {
      setPeople([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/meetings/options?q=${encodeURIComponent(query)}${includeSelf ? "&self=true" : ""}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((json) => {
          setPeople(json?.data ?? []);
          setActive(0);
        })
        .catch(() => undefined);
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, includeSelf]);

  const options = people.filter((person) => !exclude.includes(person.memberId));

  function pick(person: PickedPerson) {
    onPick(person);
    setQuery("");
    setPeople([]);
  }

  return (
    <div className="relative">
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
      <Input
        id={id}
        value={query}
        onChange={(change) => setQuery(change.target.value)}
        onKeyDown={(event) => {
          if (options.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(options.length - 1, index + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          } else if (event.key === "Enter") {
            event.preventDefault();
            pick(options[active]);
          }
        }}
        placeholder={placeholder ?? t("form.addPeople")}
        autoComplete="off"
        className="pl-9"
        role="combobox"
        aria-expanded={options.length > 0}
        aria-controls={`${id}-options`}
      />
      {options.length > 0 ? (
        <ul id={`${id}-options`} role="listbox" aria-label={t("form.peopleList")} className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-menu">
          {options.map((person, index) => (
            <li key={person.memberId}>
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                onMouseMove={() => setActive(index)}
                onClick={() => pick(person)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-table text-fg ${index === active ? "bg-hover" : ""}`}
              >
                <PersonAvatar person={person} />
                <span className="min-w-0">
                  <span className="block truncate">{person.fullName}</span>
                  {person.jobTitle ? <span className="block truncate text-meta text-fg-subtle">{person.jobTitle}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
