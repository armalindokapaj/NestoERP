"use client";

import * as React from "react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog, useCommand } from "@/components/engineering/form-kit";
import { usePeopleTranslations } from "@/components/people/people-text";
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
  const t = usePeopleTranslations();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {t("editor.editOwn")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("editor.ownTitle")}
        description={t("editor.ownDescription")}
        fields={[
          { name: "preferredName", label: t("editor.preferredName"), type: "text", placeholder: t("editor.optional") },
          { name: "workPhoneExtension", label: t("editor.extension"), type: "text" },
          { name: "officeLocation", label: t("editor.whereFindYou"), type: "text", placeholder: t("editor.wherePlaceholder") },
          { name: "professionalBio", label: t("editor.aboutWork"), type: "textarea", rows: 4, hint: t("editor.aboutHint") },
        ]}
        initial={profile}
        submitLabel={t("editor.save")}
        saveKind="save"
        module="people"
        testId="own-profile-dialog"
        onSubmit={async (payload) => {
          await engineeringApi("/api/people/me/work-profile", { method: "PATCH", body: payload });
          await run("own-profile", async () => null, t("editor.saved"));
        }}
      />
    </>
  );
}

export function ManageProfileButton({ profile, name }: { profile: Profile; name: string }) {
  const { run } = useCommand();
  const t = usePeopleTranslations();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {t("editor.editWork")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("editor.managedTitle", { name })}
        description={t("editor.managedDescription")}
        fields={[
          { name: "jobTitle", label: t("editor.jobTitle"), type: "text" },
          { name: "preferredName", label: t("editor.preferredNameThey"), type: "text" },
          { name: "workEmail", label: t("editor.workEmail"), type: "email" },
          { name: "workPhoneExtension", label: t("editor.extension"), type: "text" },
          { name: "officeLocation", label: t("editor.whereFindThem"), type: "text" },
        ]}
        initial={profile}
        submitLabel={t("editor.save")}
        saveKind="save"
        module="people"
        testId="managed-profile-dialog"
        onSubmit={async (payload) => {
          await engineeringApi(`/api/people/${profile.personId}/work-profile`, { method: "PATCH", body: payload });
          await run("managed-profile", async () => null, t("editor.saved"));
        }}
      />
    </>
  );
}
