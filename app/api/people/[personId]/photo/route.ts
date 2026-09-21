import { apiOk, withContext } from "@/lib/api/respond";
import { readPhoto, removePhoto, setPhoto } from "@/lib/modules/people/person.photo";
import { photoBytes } from "@/lib/modules/people/person.photo.request";

type Params = { params: Promise<{ personId: string }> };

/**
 * GET /api/people/:personId/photo — the person's photo, for whoever may read
 * their work profile (E-08 §43). `private` caching: the URL carries the photo's
 * checksum, so a changed photo is a new URL.
 */
export async function GET(_request: Request, { params }: Params) {
  const { personId } = await params;
  // `group: "read"`: every avatar on a group list is this request (Workspace Context §45).
  return withContext(
    async (context) => {
      const photo = await readPhoto(context, personId);
      return new Response(Buffer.from(photo.body), {
        status: 200,
        headers: {
          "Content-Type": photo.contentType,
          "Content-Disposition": "inline",
          "Cache-Control": "private, max-age=86400",
          ETag: photo.etag,
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
    { group: "read" },
  );
}

/** PUT /api/people/:personId/photo — sets somebody's photo: those who keep person records, within reach (E-08 §93). */
export async function PUT(request: Request, { params }: Params) {
  const { personId } = await params;
  return withContext(async (context) => apiOk({ data: await setPhoto(context, personId, await photoBytes(request)) }));
}

/** DELETE /api/people/:personId/photo — removes it; the profile shows initials again. */
export async function DELETE(_request: Request, { params }: Params) {
  const { personId } = await params;
  return withContext(async (context) => apiOk({ data: await removePhoto(context, personId) }));
}
