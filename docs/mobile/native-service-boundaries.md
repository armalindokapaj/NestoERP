# Native service boundaries (MOB-07 §25, §78-§81, §103-§105)

| Service | Where | Web adapter today | Native (MOB-08) |
| --- | --- | --- | --- |
| CaptureService (`capturePhoto`, `selectPhotos`, `selectFiles`) | `lib/field/capture-service.ts` | hidden `<input type=file [capture]>` | register with `setCaptureService` |
| DocumentService (`resolveAccess`) | `lib/field/document-service.ts` | `POST /api/documents/:id/preview` | unchanged (same API) |
| Upload | `components/documents/upload-client.ts` | XHR PUT to signed URL | background URLSession / WorkManager behind the same steps |
| Image prepare | `lib/field/image-prepare.ts` | canvas / `createImageBitmap` | native resize |

Rules: no business component references `window.webkit`, an Android bridge, Capacitor or React Native. `CaptureError`
(`PERMISSION_DENIED`) lets an adapter that can tell a denial from a cancel show "enable access or choose a file"
(`EvidenceCapture` already does). The camera is requested only when the button is pressed, never at startup.

Still to define in MOB-08: FilePicker / share sheet service, QR scan, document scanner, local pending-capture store with a
logout warning.
