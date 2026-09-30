# Mobile capture (MOB-07 §24-§34, §57-§61, §90-§92)

Components: `components/field/`

- **`EvidenceCapture`**: Take photo (touch devices) / Choose photos / Upload file, a preview of the last capture,
  a strip with per-item remove, **Retake**, and **Use photo(s)**. Nothing uploads before "Use"; removing a staged item
  touches no canonical document.
- **`RecordEvidence`** ("Add evidence"): `EvidenceCapture` + an optional text note, on a record the reader is already
  viewing. Used through `RecordDocuments captureEvidence`, enabled on Task and on every HSE record.
- **`ProjectCapture`** (Capture button on a project's Documents): a sheet with Site diary, Report an HSE hazard / incident
  (only the ones the reader may create) and a project-scoped photo/file upload. No project picker.
- **`DeferredEvidence`** (HSE hazard / incident report): photos stay on the device as "Not uploaded yet"; the canonical
  create action runs first, then the files upload to the new record. On failure the form stays with Retry and a link to
  continue. The upload list renders outside the form's fieldset (a saved form disables its controls).
- **Quick Create** gains "HSE hazard"; the Site diary (daily log) and HSE incident actions already existed.

Image preparation (`lib/field/image-prepare.ts`): a JPEG over 1.5 MB is re-encoded at <= 3200 px / q 0.9 off the main
thread (`createImageBitmap`); smaller JPEGs only lose EXIF/GPS segments. PNGs and non-images are untouched. `keepOriginal`
skips all of it for evidence that must stay original. GPS is never captured.

Not built: photo annotation, document scanning, QR/barcode (architecture only; add a method to `CaptureService`).
