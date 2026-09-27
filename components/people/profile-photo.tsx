"use client";

import * as React from "react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { useCommand } from "@/components/engineering/form-kit";
import { Button } from "@/components/ui/button";
import { UnsavedValue } from "@/components/unsaved/unsaved-value";

/**
 * Setting or removing a profile photo (E-08 §43, §93): the person's own, or —
 * for those who keep person records — somebody's. The server decides who may
 * and which images it takes (JPEG, PNG or WebP, up to 2 MB); this only appears
 * for a reader who may.
 */
/**
 * The photo rules as the server enforces them (`lib/modules/people/person.photo.ts`).
 * AUD-09: candidate for an isomorphic `MAX_PHOTO_BYTES` export — the ceiling
 * lives in a server module today, so the sentence repeats its number.
 */
const PHOTO_RULES = "A JPEG, PNG or WebP image, up to 2 MB. It is checked by its contents, not its name.";

export function ProfilePhotoButton({ personId, self, hasPhoto }: { personId: string; self: boolean; hasPhoto: boolean }) {
  const { pending, run } = useCommand();
  const input = React.useRef<HTMLInputElement>(null);
  const url = self ? "/api/people/me/photo" : `/api/people/${personId}/photo`;
  const hintId = React.useId();

  async function upload(file: File) {
    await run(
      "photo",
      async () => {
        const form = new FormData();
        form.append("photo", file);
        const response = await fetch(url, { method: "PUT", body: form });
        if (!response.ok) {
          const json = (await response.json().catch(() => null)) as { error?: { message?: string; details?: Record<string, unknown> } } | null;
          const field = Object.values(json?.error?.details ?? {}).find((value): value is string[] => Array.isArray(value) && typeof value[0] === "string");
          throw { status: response.status, code: "PHOTO", message: field?.[0] ?? json?.error?.message ?? "The photo could not be saved.", details: {} };
        }
      },
      "Photo saved.",
    );
  }

  return (
    <>
      {/* A photo on its way up would be lost by leaving now (AUD-03 §3 files). */}
      {pending === "photo" ? <UnsavedValue dirty={false} saving module="people" saveKind="none" label={self ? "Your photo" : "Profile photo"} /> : null}
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label={self ? "Choose your photo" : "Choose a photo"}
        aria-describedby={hintId}
        data-testid="profile-photo-input"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void upload(file);
        }}
      />
      <Button type="button" size="sm" variant="secondary" disabled={pending === "photo"} onClick={() => input.current?.click()} title={PHOTO_RULES}>
        {hasPhoto ? "Change photo" : "Add photo"}
      </Button>
      {/* What is accepted, before choosing (AUD-09 §8). The server reads the
          image's bytes, not its name, and refuses anything else. */}
      <span id={hintId} className="text-meta text-fg-subtle" data-testid="profile-photo-rules">
        {PHOTO_RULES}
      </span>
      {hasPhoto ? (
        <Button size="sm" variant="ghost" disabled={pending === "photo"} onClick={() => void run("photo", () => engineeringApi(url, { method: "DELETE" }), "Photo removed.")}>
          Remove photo
        </Button>
      ) : null}
    </>
  );
}
