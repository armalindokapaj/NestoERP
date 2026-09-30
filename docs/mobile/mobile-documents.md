# Mobile documents (MOB-07 §8-§15, §62-§77)

There is one Document record. Phones use the same `Document`, `DocumentVersion`, storage,
scan and parent-access code as desktop; nothing here is a mobile copy.

- **Library and project documents:** `/documents/*` and `/projects/:id/documents` already render through the
  MOB-03 responsive `DataTable` (card per document). The project is fixed by the route; search, filters and
  scope are server-side (`documentListQuerySchema`), so nothing unauthorised is fetched and hidden.
- **Detail:** `DocumentFilePanel` previews in place (`<img>` / desktop PDF) and adds **View**, which opens the
  full-screen viewer (see mobile-viewers.md). Download and preview always ask for a short-lived grant.
- **Sensitive documents:** `document.parent-access.ts` ties a file to its parent record's module and record
  permissions. Project membership alone never opens a Finance, Legal or HR file.
- **Versions:** version history and the "previous version" handling stay in `document-versions.tsx`; mobile adds no path
  around it. Replacing a file creates a new `DocumentVersion`.
- **Delete / share:** unchanged canonical rules; no public links are generated.
- **Storage provider:** the UI never reads a storage path. `lib/field/document-service.ts#resolveAccess` returns
  `{ url, mimeType, kind }` from the preview route, so another provider only changes the server.

Not built: PDF thumbnails (images only; `thumbnail.service.ts`), a mobile-specific category taxonomy (none is wanted).
