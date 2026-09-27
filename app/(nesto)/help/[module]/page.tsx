import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ModuleHelpPage } from "@/components/help/help-page";
import { modules } from "@/config/modules";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireUserContext } from "@/lib/context/current-user";
import { helpAccess } from "@/lib/help/help-access";
import { MODULE_HELP } from "@/lib/help/help-content";
import { moduleForHelpSlug } from "@/lib/help/help-routes";

type Props = { params: Promise<{ module: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const key = moduleForHelpSlug((await params).module);
  return { title: key ? `${modules[key].label} help` : "Help" };
}

/**
 * One module's Help (AUD-05 §7, UX-16): its purpose, terms, the actions this
 * reader may take and what decides access. A module the reader cannot open in
 * this workspace answers as missing, the same as one that does not exist.
 */
export default async function ModuleHelpRoute({ params }: Props) {
  const [{ module: slug }, context] = await Promise.all([params, requireUserContext()]);
  const key = moduleForHelpSlug(slug);
  if (!key) notFound();
  const access = await helpAccess(context);
  if (!access.modules.includes(key)) notFound();

  const help = MODULE_HELP[key];
  // The sections this reader sees, named as their tabs name them — in a company workspace, where tabs exist.
  const sections = context.workspace.scopeType === "COMPANY" ? resolveModuleExperience(context, key).sections.map((section) => section.label) : [];
  const actions = help.actions.filter((action) => access.holds(action.permission));

  return <ModuleHelpPage moduleKey={key} help={help} sections={sections} actions={actions} />;
}
