"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog } from "@/components/engineering/form-kit";
import { Button } from "@/components/ui/button";
import type { RecruitmentOptionsDTO } from "@/lib/modules/hr/recruitment/candidate.options";
import { candidateFields } from "./candidate-fields";

/** Adds a person HR is interviewing, before any login exists (E-06 §22, §62). */
export function NewCandidateButton({ choices, defaultCompanyId }: { choices: RecruitmentOptionsDTO; defaultCompanyId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [companyId, setCompanyId] = React.useState(defaultCompanyId);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Add candidate
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Add candidate"
        description="The person and where they are being recruited to. Nobody gets a login from this."
        fields={candidateFields(choices, companyId)}
        initial={{ targetCompanyId: defaultCompanyId }}
        onValuesChange={(values) => setCompanyId(String(values.targetCompanyId ?? ""))}
        submitLabel="Add candidate"
        wide
        testId="candidate-dialog"
        onSubmit={async (payload) => {
          const candidate = await engineeringApi<{ id: string }>("/api/hr/candidates", { body: payload });
          router.push(`/hr/recruitment/${candidate.id}`);
        }}
      />
    </>
  );
}
