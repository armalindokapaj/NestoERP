import type { Metadata } from "next";

import { InboxView } from "@/components/productivity/inbox-view";
import { inGroupWorkspace } from "@/config/workspace";
import { can, canAccessModule } from "@/lib/access/can";
import { requireUserContext } from "@/lib/context/current-user";
import { getLocale, getTranslations } from "@/lib/i18n/server";
import { activityFilters, activityQuerySchema } from "@/lib/modules/activity/activity-center.schema";
import { listActivity } from "@/lib/modules/activity/activity-center.service";
import { approvalQuerySchema } from "@/lib/modules/approvals/approvals.schema";
import { listApprovalsForWorkspace } from "@/lib/modules/approvals/approvals.group";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("misc"))("inbox.title") };
}

/** How many of each the Inbox shows; the full lists are one tap away. */
const LIMIT = 20;

/**
 * /inbox — Inbox, the fourth place in the phone's bar (docs/ui/UI-04-navigation-layouts.md
 * §Phone): the approvals waiting for this person, then their notifications and
 * announcements. Both are read through the same services the Approvals Center
 * and the Activity Center use, in the person's own scope; a source that could
 * not be read says so instead of reading as "nothing".
 */
export default async function InboxPage() {
  const context = await requireUserContext();
  const locale = await getLocale();
  const group = inGroupWorkspace(context);
  const mayApprove = group || (canAccessModule(context, "approvals") && can(context, "approvals.view"));

  const [approvals, activity] = await Promise.all([
    mayApprove
      ? listApprovalsForWorkspace(context, approvalQuerySchema.parse({ tab: "waiting" })).then(
          (result) => result.items.slice(0, LIMIT),
          () => null,
        )
      : Promise.resolve([]),
    listActivity(context, { ...activityFilters(activityQuerySchema.parse({})), cursor: null }, locale).then(
      (page) => page.items.slice(0, LIMIT),
      () => null,
    ),
  ]);

  return <InboxView data={{ approvals, group, activity }} />;
}
