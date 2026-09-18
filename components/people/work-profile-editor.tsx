"use client";

import * as React from "react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, useCommand } from "@/components/engineering/form-kit";
import { Button } from "@/components/ui/button";

type Profile = {
  personId: string;
  preferredName: string | null;
  jobTitle: string | null;
  workEmail: string | null;
  workPhoneExtension: string | null;
  officeLocation: string | null;
  professionalBio: string | null;
};

/**
 * Editing a work profile (E-01 §53, §116). Your own: the bio, extension,
 * office and the name you go by — your name and phone are your account's.
 * Somebody else's, for those who keep person records: also the job title and
 * work email. The server decides who may; these only appear for them.
 */
export function EditOwnProfileButton({ profile }: { profile: Profile }) {
  const { run } = useCommand();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Edit your profile
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Your work profile"
        description="What your colleagues across the group see. Your name and phone are changed in Settings → Profile."
        fields={[
          { name: "preferredName", label: "Name you go by", type: "text", placeholder: "Optional" },
          { name: "workPhoneExtension", label: "Extension", type: "text" },
          { name: "officeLocation", label: "Where to find you", type: "text", placeholder: "Office, floor or site" },
          { name: "professionalBio", label: "About your work", type: "textarea", rows: 4, hint: "A few lines, up to 1 000 characters." },
        ]}
        initial={profile}
        submitLabel="Save"
        testId="own-profile-dialog"
        onSubmit={async (payload) => {
          await engineeringApi("/api/people/me/work-profile", { method: "PATCH", body: payload });
          await run("own-profile", async () => null, "Profile saved.");
        }}
      />
    </>
  );
}

export function ManageProfileButton({ profile, name }: { profile: Profile; name: string }) {
  const { run } = useCommand();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Edit work profile
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={`${name}'s work profile`}
        description="The record colleagues across the group read. Personal details and employment are kept in HR."
        fields={[
          { name: "jobTitle", label: "Job title", type: "text" },
          { name: "preferredName", label: "Name they go by", type: "text" },
          { name: "workEmail", label: "Work email", type: "email" },
          { name: "workPhoneExtension", label: "Extension", type: "text" },
          { name: "officeLocation", label: "Where to find them", type: "text" },
        ]}
        initial={profile}
        submitLabel="Save"
        testId="managed-profile-dialog"
        onSubmit={async (payload) => {
          await engineeringApi(`/api/people/${profile.personId}/work-profile`, { method: "PATCH", body: payload });
          await run("managed-profile", async () => null, "Profile saved.");
        }}
      />
    </>
  );
}
