import { createHash } from "node:crypto";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { detectType } from "@/lib/core/storage";
import { storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { prisma } from "@/lib/database/prisma";
import { setPersonPhoto } from "@/lib/modules/hr/person.doors";
import { getWorkProfile, photoAuthority, readablePhoto } from "./people.service";
import type { WorkProfileDTO } from "./people.types";

/**
 * The profile photo (E-08 §43, §93; ADR 0008).
 *
 * The photo is the person's, across the group — a candidate has no company and
 * a colleague in any company of the group sees it — so it is not a company
 * document. Its object lives under `people/<group>/<person>/`, named by its
 * checksum; the person record holds the key, and the photo URL carries the
 * checksum, so a changed photo is a new URL and an old one may be cached.
 *
 * Only images, recognised by their bytes rather than their name or declared
 * type, and small: a photo is an avatar, not a document.
 */

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const EXTENSION: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Sets the photo of `target` — the reader's own (`"me"`) or, for those who keep person records, somebody's. */
export async function setPhoto(context: UserContext, target: string | "me", bytes: Uint8Array): Promise<WorkProfileDTO> {
  const { personId, via } = await photoAuthority(context, target);
  if (bytes.byteLength === 0) throw new AccessError("VALIDATION_ERROR", "Choose a photo.", { field: "photo", code: "PHOTO_EMPTY" });
  if (bytes.byteLength > MAX_PHOTO_BYTES) throw new AccessError("VALIDATION_ERROR", "A photo can be at most 2 MB.", { field: "photo", code: "PHOTO_TOO_LARGE" });
  const detected = detectType(bytes.subarray(0, 64));
  const extension = detected.mime && !detected.dangerous ? EXTENSION[detected.mime] : undefined;
  if (!extension || !detected.mime) throw new AccessError("VALIDATION_ERROR", "A photo must be a JPEG, PNG or WebP image.", { field: "photo", code: "PHOTO_TYPE" });

  const checksum = createHash("sha256").update(bytes).digest("hex");
  const storageKey = `people/${context.parentGroupId}/${personId}/${checksum.slice(0, 32)}.${extension}`;
  await storageProvider().putObject(storageKey, bytes, detected.mime);

  const person = await prisma.personProfile.findFirstOrThrow({ where: { id: personId, parentGroupId: context.parentGroupId }, select: { firstName: true, lastName: true, photoChecksum: true } });
  const { previousKey } = await prisma.$transaction(async (tx) => {
    const result = await setPersonPhoto(tx, { personProfileId: personId, parentGroupId: context.parentGroupId, photo: { storageKey, contentType: detected.mime!, checksum, sizeBytes: bytes.byteLength } });
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.PERSON_PROFILE_PHOTO_UPDATED,
        entity: { type: "PersonProfile", id: personId, label: `${person.firstName} ${person.lastName}` },
        before: { photo: person.photoChecksum ? "set" : "none" },
        after: { photo: "set", contentType: detected.mime, sizeBytes: bytes.byteLength },
        metadata: { via },
      },
      { tx },
    );
    return result;
  });
  if (previousKey && previousKey !== storageKey) await storageProvider().deleteObject(previousKey).catch(() => undefined);
  return getWorkProfile(context, personId);
}

/** Removes the photo; the profile shows initials again. */
export async function removePhoto(context: UserContext, target: string | "me"): Promise<WorkProfileDTO> {
  const { personId, via } = await photoAuthority(context, target);
  const person = await prisma.personProfile.findFirstOrThrow({ where: { id: personId, parentGroupId: context.parentGroupId }, select: { firstName: true, lastName: true, photoChecksum: true } });
  if (!person.photoChecksum) return getWorkProfile(context, personId);
  const { previousKey } = await prisma.$transaction(async (tx) => {
    const result = await setPersonPhoto(tx, { personProfileId: personId, parentGroupId: context.parentGroupId, photo: null });
    await recordUserAction(
      context,
      { actionKey: AuditAction.PERSON_PROFILE_PHOTO_UPDATED, entity: { type: "PersonProfile", id: personId, label: `${person.firstName} ${person.lastName}` }, before: { photo: "set" }, after: { photo: "none" }, metadata: { via } },
      { tx },
    );
    return result;
  });
  if (previousKey) await storageProvider().deleteObject(previousKey).catch(() => undefined);
  return getWorkProfile(context, personId);
}

/** The photo's bytes, for a reader who may see the person's full work profile. */
export async function readPhoto(context: UserContext, personId: string): Promise<{ body: Uint8Array; contentType: string; etag: string }> {
  const photo = await readablePhoto(context, personId);
  if (!photo) throw new AccessError("NOT_FOUND");
  const body = await storageProvider().getObject(photo.storageKey);
  if (!body) throw new AccessError("NOT_FOUND");
  return { body, contentType: photo.contentType, etag: `"${photo.checksum.slice(0, 32)}"` };
}
