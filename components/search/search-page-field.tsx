"use client";

import * as React from "react";
import { useFeedbackRouter } from "@/components/navigation/navigation-feedback";

import { useMiscTranslations } from "@/components/activity/misc-text";
import { SearchField } from "@/components/ui/search-field";

/**
 * The search box on /search (PRD #26 §12, §166).
 *
 * Submits through the URL rather than fetching, so the page stays a server
 * component and a search is a link somebody can bookmark, share or reload. It
 * is a form: pressing Enter searches, which is what the keyboard expects, and
 * it works with JavaScript disabled.
 */
export function SearchPageField({ defaultValue, company }: { defaultValue: string; company?: string }) {
  const router = useFeedbackRouter();
  const m = useMiscTranslations();
  const [value, setValue] = React.useState(defaultValue);

  // A new query from elsewhere (a link, the back button) has to win over what
  // this field is holding.
  React.useEffect(() => setValue(defaultValue), [defaultValue]);

  return (
    <form
      action="/search"
      onSubmit={(event) => {
        event.preventDefault();
        const term = value.trim();
        // The Group workspace's company filter survives a new search (§87).
        router.push(term ? `/search?q=${encodeURIComponent(term)}${company ? `&company=${encodeURIComponent(company)}` : ""}` : "/search");
      }}
    >
      <SearchField
        name="q"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={m("search.placeholder")}
        aria-label={m("search.label")}
        autoFocus
      />
    </form>
  );
}
