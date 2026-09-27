import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PpeForm } from "@/components/hse/ppe-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { updatePpeCheckAction } from "@/lib/actions/hse";
import { AccessError } from "@/lib/access/guards";
import * as ppe from "@/lib/modules/hse/ppe/ppe.service";
import { WORKER_PREFIX } from "@/lib/modules/hse/hse.schema";
import { getTranslations } from "@/lib/i18n/server";

type Params = { params: Promise<{ checkId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hse");
  return { title: t("page.editPpeCheck") };
}

/**
 * Correcting a PPE check (PRD #22 §158, §161).
 *
 * A check is an observation of what somebody was wearing at a moment, so the
 * correction path exists for getting that observation right — not for changing
 * the finding later. The service decides what is still editable; this page
 * only offers the form.
 */
export default async function EditPpeCheckPage({ params }: Params) {
  const { checkId } = await params;
  const context = await requireModule("hse");
  const t = await getTranslations("hse");
  if (!can(context, "hse.ppe.update")) notFound();

  let check;
  try {
    check = await ppe.getPpeCheck(context, checkId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const options = await ppe.ppeFormOptions(context);

  async function action(formData: FormData) {
    "use server";
    return updatePpeCheckAction(checkId, formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: t("page.crumbPpe"), href: "/hse/ppe" },
          { label: check.checkNumber },
          { label: t("template.detail.edit") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("page.editNumber", { number: check.checkNumber })}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {t("page.ppeEditIntro")}
        </p>
      </div>

      <PpeForm
        action={action}
        cancelHref="/hse/ppe"
        submitLabel={t("page.saveCheck")}
        pendingLabel={t("page.saving")}
        values={{
          projectId: check.project?.id ?? "",
          checkDate: check.checkDate.slice(0, 10),
          locationText: check.locationText ?? "",
          subjectMemberId: check.subject?.memberId ?? (check.subjectWorker ? `${WORKER_PREFIX}${check.subjectWorker.employeeId}` : ""),
          externalSubjectName: check.externalSubjectName ?? "",
          // The DTO carries only the equipment the check actually spoke to, and
          // the form's third state — "not looked at" — is the absence of a key.
          // Mapping it any other way would file a silence as a pass (§159).
          items: Object.fromEntries(
            check.items.map((item) => [item.key, item.ok ? "yes" : "no"]),
          ),
          otherPpeNote: check.otherPpeNote ?? "",
          notes: check.notes ?? "",
        }}
        projects={options.projects.map((project) => ({
          value: project.id,
          label: `${project.code} — ${project.name}`,
        }))}
        members={options.members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName}`,
        }))}
        workers={options.workers.map((worker) => ({ value: `${WORKER_PREFIX}${worker.id}`, label: worker.name }))}
      />
    </div>
  );
}
