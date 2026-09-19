import { apiOk, withContext } from "@/lib/api/respond";
import { removePhoto, setPhoto } from "@/lib/modules/people/person.photo";
import { photoBytes } from "@/lib/modules/people/person.photo.request";

/** PUT /api/people/me/photo — your own profile photo (E-08 §93). */
export async function PUT(request: Request) {
  return withContext(async (context) => apiOk({ data: await setPhoto(context, "me", await photoBytes(request)) }));
}

/** DELETE /api/people/me/photo — removes your photo. */
export async function DELETE() {
  return withContext(async (context) => apiOk({ data: await removePhoto(context, "me") }));
}
