import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import {
  Field,
  FormSection,
  RecordForm,
  selectClass,
} from "@/components/forms/record-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Input } from "@/components/ui/input";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { escalateDefectAction } from "@/lib/actions/qaqc";
import * as defects from "@/lib/modules/qaqc/defects/defect.service";
import { NCR_CATEGORIES } from "@/lib/modules/qaqc/qaqc.status";
import { qaqcLabel } from "@/components/qaqc/qaqc-labels";

type Params = { params: Promise<{ defectId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("qaqc");
  return { title: t("meta.raiseNcr") };
}

/**
 * Turning a defect into a formal non-conformance (PRD #21 §170, §172).
 *
 * The defect stays exactly where it is: the site still has to fix the thing
 * whatever the paperwork says. The NCR asks the separate question of *why it
 * happened*, and cannot close until somebody answers it.
 */
export default async function EscalateDefectPage({ params }: Params) {
  const { defectId } = await params;
  const context = await requireModule("qaqc");
  const t = await getTranslations("qaqc");

  let defect;
  try {
    defect = await defects.getDefect(context, defectId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!defect.capabilities.canEscalate) notFound();

  async function action(formData: FormData) {
    "use server";
    return escalateDefectAction(defectId, formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: t("common.qaqc"), href: "/qaqc" },
          { label: t("crumbs.defects"), href: "/qaqc/defects" },
          { label: defect.defectNumber, href: `/qaqc/defects/${defect.id}` },
          { label: t("crumbs.raiseNcr") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("meta.raiseNcr")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {t("defectPage.escalateIntro", { number: defect.defectNumber })}
        </p>
      </div>

      <RecordForm
        module="qaqc"
        action={action}
        cancelHref={`/qaqc/defects/${defect.id}`}
        submitLabel={t("defectPage.raiseNcr")}
        pendingLabel={t("common.raising")}
      >
        <FormSection
          title={t("defectPage.escalateSection")}
          description={t("defectPage.escalateBody")}
        >
          <Field label={t("defectPage.title")} name="title" className="sm:col-span-2">
            <Input
              id="title"
              name="title"
              defaultValue={defect.title}
              maxLength={200}
            />
          </Field>

          <Field
            label={t("detail.category")}
            name="category"
            required
            className="sm:col-span-2"
            hint={t("defectPage.categoryHint")}
          >
            <select
              id="category"
              name="category"
              className={selectClass}
              defaultValue="WORKMANSHIP"
              required
            >
              {NCR_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {qaqcLabel(t, "ncrCategory", category)}
                </option>
              ))}
            </select>
          </Field>
        </FormSection>
      </RecordForm>
    </div>
  );
}
