import { AccessError } from "@/lib/access/guards";
import { MAX_PHOTO_BYTES } from "./person.photo";

/**
 * The photo's bytes from a request: a form with a `photo` file, or the image as
 * the body. Refused before it is read when the declared length is too large.
 */
export async function photoBytes(request: Request): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  // A form adds its boundaries; anything well past the limit is not a photo.
  if (declared > MAX_PHOTO_BYTES + 64 * 1024) throw new AccessError("VALIDATION_ERROR", "A photo can be at most 2 MB.", { field: "photo", code: "PHOTO_TOO_LARGE" });
  if ((request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    const file = (await request.formData()).get("photo");
    if (!(file instanceof Blob)) throw new AccessError("VALIDATION_ERROR", "Choose a photo.", { field: "photo", code: "PHOTO_EMPTY" });
    return new Uint8Array(await file.arrayBuffer());
  }
  return new Uint8Array(await request.arrayBuffer());
}
