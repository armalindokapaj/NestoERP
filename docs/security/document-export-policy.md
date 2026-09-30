# Document export and share policy

Policy flags `documentExportAllowed`, `nativeShareAllowed`, `externalOpenAllowed` (AND across levels). The download routes (`/api/documents/[id]/download` and the version download) check them server-side through `mobile-policy.guard.ts`; the app hides the matching controls but the server is what refuses. Viewing in the app stays available.
