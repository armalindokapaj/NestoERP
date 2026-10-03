import type { PlatformCommandMenu } from "@/components/platform/platform-command";

type Item = React.ComponentProps<typeof PlatformCommandMenu>["items"][number];
type Subject = { kind: "company" | "group"; id: string; name: string };

const REASON = { name: "reason", label: "Reason", type: "textarea" as const, required: true };

function confirmName(name: string) {
  return { name: "confirmationName", label: `Type “${name}” to confirm`, type: "text" as const, required: true };
}

/** Delete: ends access at once, keeps every row, restorable (Platform Recovery). */
export function deleteItem({ kind, id, name }: Subject, days: number): Item {
  const group = kind === "group";
  return {
    label: group ? "Delete group" : "Delete company",
    title: `Delete ${name}?`,
    description: `${group ? "The group and all of its companies lose access immediately" : "Everyone loses access to this company immediately"}. Nothing is erased: you can restore ${group ? "them" : "it"} from Recovery, and it becomes eligible for permanent removal after ${days} days.`,
    action: `${kind}.delete`,
    fixed: { [`${kind}Id`]: id },
    fields: [confirmName(name), REASON],
    destructive: true,
    submitLabel: group ? "Delete Group" : "Delete Company",
    success: group ? "Group deleted. It can be restored from Recovery." : "Company deleted. It can be restored from Recovery.",
  };
}

export function restoreItem({ kind, id, name }: Subject): Item {
  const group = kind === "group";
  return {
    label: "Restore",
    title: `Restore ${name}?`,
    description: `${group ? "The group and the companies deleted with it" : "The company"} return exactly as they were, with the same status and data. People regain access according to their memberships.`,
    action: `${kind}.restore`,
    fixed: { [`${kind}Id`]: id },
    reasonOnly: true,
    submitLabel: "Restore",
    success: group ? "Group restored." : "Company restored.",
  };
}

/** Permanent removal: irreversible, so the name is typed back. */
export function purgeItem({ kind, id, name }: Subject): Item {
  const group = kind === "group";
  return {
    label: "Delete permanently",
    title: `Permanently delete ${name}?`,
    description: `This erases ${group ? "the group, its companies" : "the company"} and everything inside ${group ? "them" : "it"}: projects, documents, files, finance and history. It cannot be undone.`,
    action: `${kind}.purge`,
    fixed: { [`${kind}Id`]: id },
    fields: [confirmName(name), REASON],
    destructive: true,
    submitLabel: "Delete Permanently",
    success: group ? "Group permanently deleted." : "Company permanently deleted.",
  };
}
