# Mobile Projects (MOB-05)

`/projects` is one page for every viewport. On a phone it shows one card per row (landscape cover, status on the image, project name, managing company, city) or, with the list toggle, one compact row per project.

- **Search** — the page's own `q` search, server side, debounced into the URL. It matches name, code, city, country and, in the Group workspace, the company name.
- **No company filter** — the workspace is the organisational filter (Projects Grid PRD); the search also matches company names in the Group workspace.
- **Cards / List** — a per-viewer preference kept in `localStorage` (key `nesto:projects-view`); the page renders as cards without it.
- **Company always shown** — on the card and on the compact row (`ProjectCompactRow`), because names can repeat across companies.
- **Images** — thumbnails only, fixed aspect ratio, lazy loading (unchanged `ProjectCover`).
- **Empty vs. no result** — "No projects available" (with Create only for someone who may create) is distinct from "No projects match your search" (with Clear search).
- **Pagination** — cursor "Load more"; no per-card requests.
