import type { Locale } from "@/lib/i18n/config";

/**
 * Published release notes (UI-01 §10.3). Checked in, so what the person reads is
 * what was reviewed: no entry is fetched from outside NESTO, and none carries
 * markup. Newest first. An entry is shown to everyone the page is open to, so
 * it names product behaviour only, never a customer, a record or an account.
 */
export type ReleaseNote = {
  id: string;
  /** ISO date the entry was published. */
  date: string;
  title: Record<Locale, string>;
  body: Record<Locale, string[]>;
};

export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    id: "2026-10-universal-header",
    date: "2026-10-09",
    title: {
      en: "One header, the same three controls everywhere",
      sq: "Një krye, të njëjtat tre kontrolle kudo",
    },
    body: {
      en: [
        "Search, Notifications and your Account now sit together at the top right of every page, including the Platform Admin console and the Group area.",
        "The account panel gathers your profile, account settings, workspace, appearance (Light, Dark or System), Help and sign-out in one place.",
      ],
      sq: [
        "Kërkimi, Njoftimet dhe Llogaria juaj tani qëndrojnë së bashku lart djathtas në çdo faqe, përfshirë konsolën e administrimit të platformës dhe zonën e grupit.",
        "Paneli i llogarisë mbledh profilin, cilësimet e llogarisë, hapësirën e punës, pamjen (e çelët, e errët ose sistemi), ndihmën dhe daljen në një vend.",
      ],
    },
  },
];
