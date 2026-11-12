> **Chat:** Nesto — mobile for the site team
> **File:** docs/perf/PERF-01-quick-wins.md
> **About:** The first round of speed work after the 2026-11-12 review of the platform — what each change does, where it lives, and what the review left for the next rounds — for whoever measures or changes loading next.
> **Last updated:** 2026-11-12 (step 1: quick wins)

# PERF-01 — Speed, step 1: quick wins

The review found pages reading the same data more than once, a font arriving
late on every screen, phones with no way to prepare a page before a tap, and
one list counting its rows four times. Step 1 fixes those; none of it changes
what a person may see.

## What changed

| Change | Where | Effect |
| --- | --- | --- |
| A project is read once per request | `readProject` and `loadProject` in `app/(nesto)/projects/[projectId]/project-context.tsx`, wrapped in React's request `cache()`; the tabs use `readProject` | The page's title, the project's tabs and the page itself asked for the project three times on a full load; now once. Nothing outlives the request. |
| A favourite is read once per request | `favoriteState` in `components/productivity/record-favorite.tsx`, `cache()` | The tabs and the Overview both asked. |
| The project switcher reads names only | `listProjectNames` (service and repository) | Was the Projects page's full summary query — client, manager and member count joins, a total count, in a snapshot transaction — for 100 projects on every project entry; now one plain read of id and name, same scope and order. |
| The mono face is preloaded; its unused weight is gone | `lib/fonts/index.ts`; six mono labels moved from 600 to 500 | Mono is on every screen since the drawing set (UI-07): its captions no longer swap after first paint. One font file less. |
| The phone bar warms its places | `components/layout/phone-bar.tsx`, `lib/navigation/intent-prefetch.ts` | A phone has no hover to prepare a page on. While it is idle, below lg, the bar asks the intent scheduler for Home (`/my-day`), Sales units and Projects (while it is the list), one at a time — under the same budget as a pointer's intent (1.5 s apart, four a minute, never twice in 60 s, nothing on Save-Data or 2g). The approved destinations are now seven: the desktop's five and those two. |
| Sales units counts in two reads, not five | `listUnitsOverview` | All the units under the filters, and the same units grouped by sale status: the views' counts and the list's total come from them. |
| The project picture is fetched once | `ProjectVisuals` | The Overview draws it twice (beside the title from lg, in the sections below) and shows one; the picture is lazy, so the hidden one is never downloaded. |

## Next (from the review)

- **Measure first:** a bundle analyser (`@next/bundle-analyzer`) and timings of
  the main pages, so the rounds below are judged by numbers.
- **Check the database region** against the functions' (`fra1`, Frankfurt).
- **Caching across requests** for data that rarely changes and is read on
  every page — company settings and modules, organisation names and logos,
  unit and project types — with tags cleared where it is edited.
- **Smaller translations:** the root layout sends the whole shell dictionary,
  the app layout the Documents and Offline ones, and each module layout its
  whole namespace; send what client components use.
- **Images:** sized variants (WebP/AVIF, `srcset`) for covers and renders.
- **The shell's icon registry** (~95 icons in the client bundle via `getIcon`).
