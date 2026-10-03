import type { PlatformCommandMenu } from "@/components/platform/platform-command";
import { createTranslator, type Translate } from "@/lib/i18n/translator";
import { adminOrgsEn } from "@/lib/i18n/modules/adminOrgs/en";

type Item = React.ComponentProps<typeof PlatformCommandMenu>["items"][number];
type Subject = { kind: "company" | "group"; id: string; name: string };
type T = Translate<"adminOrgs">;

/** A caller that passes no `t` gets the English wording; pass `await getTranslations("adminOrgs")` for the reader's language. */
const english: T = createTranslator<"adminOrgs">("en", adminOrgsEn);

function reasonField(t: T) {
  return { name: "reason", label: t("common.reason"), type: "textarea" as const, required: true };
}

function confirmName(t: T, name: string) {
  return { name: "confirmationName", label: t("recovery.confirmName", { name }), type: "text" as const, required: true };
}

/** Delete: ends access at once, keeps every row, restorable (Platform Recovery). */
export function deleteItem({ kind, id, name }: Subject, days: number, t: T = english): Item {
  const group = kind === "group";
  return {
    label: group ? t("recovery.delete.labelGroup") : t("recovery.delete.labelCompany"),
    title: t("recovery.delete.title", { name }),
    description: group ? t("recovery.delete.descriptionGroup", { days }) : t("recovery.delete.descriptionCompany", { days }),
    action: `${kind}.delete`,
    fixed: { [`${kind}Id`]: id },
    fields: [confirmName(t, name), reasonField(t)],
    destructive: true,
    submitLabel: group ? t("recovery.delete.submitGroup") : t("recovery.delete.submitCompany"),
    success: group ? t("recovery.delete.successGroup") : t("recovery.delete.successCompany"),
  };
}

export function restoreItem({ kind, id, name }: Subject, t: T = english): Item {
  const group = kind === "group";
  return {
    label: t("recovery.restore.label"),
    title: t("recovery.restore.title", { name }),
    description: group ? t("recovery.restore.descriptionGroup") : t("recovery.restore.descriptionCompany"),
    action: `${kind}.restore`,
    fixed: { [`${kind}Id`]: id },
    reasonOnly: true,
    submitLabel: t("recovery.restore.submit"),
    success: group ? t("recovery.restore.successGroup") : t("recovery.restore.successCompany"),
  };
}

/** Permanent removal: irreversible, so the name is typed back. */
export function purgeItem({ kind, id, name }: Subject, t: T = english): Item {
  const group = kind === "group";
  return {
    label: t("recovery.purge.label"),
    title: t("recovery.purge.title", { name }),
    description: group ? t("recovery.purge.descriptionGroup") : t("recovery.purge.descriptionCompany"),
    action: `${kind}.purge`,
    fixed: { [`${kind}Id`]: id },
    fields: [confirmName(t, name), reasonField(t)],
    destructive: true,
    submitLabel: t("recovery.purge.submit"),
    success: group ? t("recovery.purge.successGroup") : t("recovery.purge.successCompany"),
  };
}
