"use client";

import * as React from "react";

import { engineeringApi } from "@/components/engineering/engineering-api";
import { FormDialog } from "@/components/engineering/form-kit";
import { Button } from "@/components/ui/button";
import type { RecruitmentOptionsDTO } from "@/lib/modules/hr/recruitment/candidate.options";
import { candidateFields, withinCompany } from "./candidate-fields";
import { useHrTranslations } from "../hr-text";

/** Adds a person HR is interviewing, before any login exists (E-06 §22, §62). */
export function NewCandidateButton({ choices, defaultCompanyId }: { choices: RecruitmentOptionsDTO; defaultCompanyId: string }) {
  const t = useHrTranslations();
  const [open, setOpen] = React.useState(false);
  const [companyId, setCompanyId] = React.useState(defaultCompanyId);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {t("candidate.add")}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t("candidate.add")}
        description={t("candidate.addDescription")}
        fields={candidateFields(t, choices, companyId)}
        initial={{ targetCompanyId: defaultCompanyId }}
        onValuesChange={(values) => setCompanyId(String(values.targetCompanyId ?? ""))}
        submitLabel={t("candidate.add")}
        module="hr"
        wide
        testId="candidate-dialog"
        onSubmit={async (payload) => {
          const candidate = await engineeringApi<{ id: string }>("/api/hr/candidates", { body: withinCompany(payload, choices) });
          // Opened by the dialog after an ordinary save (AUD-03 §6).
          return { redirectTo: `/hr/recruitment/${candidate.id}` };
        }}
      />
    </>
  );
}
