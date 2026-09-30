# Mobile viewers (MOB-07 §16-§23)

`components/documents/viewer/`

- **`DocumentViewer`**: full-screen Radix dialog. It covers the bottom bar and project tabs, has one Close button
  (top left) and an "open in a new tab" link. It resolves access for the *current* item only, so a gallery never
  requests photos nobody looks at. Errors show a message and a retry.
- **`PdfViewer`** (pdf.js, `pdfjs-dist`, imported only when a PDF opens): fit-width by default, `+` / `-` / fit, two-finger
  pinch, pan by scrolling, previous/next and "3 / 18". Pages are sized placeholders; a page holds a canvas only while within
  150 % of the viewport and releases its bitmap when it leaves, so a 300-page set costs a handful of bitmaps.
  The document loads with range requests (`disableAutoFetch`), so page 1 shows before the file is complete.
  The worker is a same-origin asset, which the CSP (`worker-src 'self'`) allows. CJK CMaps and standard fonts are not
  bundled: PDFs that depend on them render with fallback glyphs.
- **`ImageViewer`**: pinch / buttons to zoom, drag to pan, previous/next for a set, "2 of 5".
- **Drawings:** DWG/DXF are download-only; the viewer shell (`kind: "file"`) is where a browser CAD viewer will plug in.
  NESTO keeps identity, permissions and lifecycle.

Known limits: pinch re-renders at the new scale rather than transforming a bitmap; if a storage provider does not allow
cross-origin GET of its signed URLs, pdf.js fails and the viewer shows its error with the open-in-tab link (the local
provider is same-origin).
