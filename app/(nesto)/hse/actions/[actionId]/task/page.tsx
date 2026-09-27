import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { HseTaskForm } from "@/components/hse/task-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as actionService from "@/lib/modules/hse/actions/action.service";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hse");
  return { title: t("page.createTask") };
}

type Params = { params: Promise<{ actionId: string }> };

/**
 * Raising a canonical Task against an HSE action (PRD #22 §126, §127, §128).
 *
 * The Task is the work item; the action keeps its own obligation and
 * verification lifecycle. Creating one advances neither.
 */
export default async function HseActionTaskPage({ params }: Params) {
  const { actionId } = await params;
  const context = await requireModule("hse");
  const t = await getTranslations("hse");
  if (!can(context, "hse.task.create")) notFound();

  let action;
  try {
    action = await actionService.getAction(context, actionId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!action.capabilities.canCreateTask) notFound();

  const options = await actionService.actionFormOptions(context);

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "HSE", href: "/hse" },
          { label: t("pages.actions.title"), href: "/hse/actions" },
          { label: action.actionNumber, href: `/hse/actions/${actionId}` },
          { label: t("page.crumbTask") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("page.createTask")}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {t("page.taskIntro", { number: action.actionNumber })}
        </p>
      </div>

      <HseTaskForm
        actionId={action.id}
        defaultTitle={action.title}
        cancelHref={`/hse/actions/${actionId}`}
        members={options.members.map((member) => ({
          value: member.id,
          label: `${member.user.firstName} ${member.user.lastName}`,
        }))}
      />
    </div>
  );
}
