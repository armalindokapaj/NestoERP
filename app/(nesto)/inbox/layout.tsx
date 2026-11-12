import { ModuleMessages } from "@/components/i18n/module-messages";

/** Inbox's strings, and the Approvals Center's, whose decision bar answers an approval in its row. */
export default function InboxLayout({ children }: { children: React.ReactNode }) {
  return <ModuleMessages namespaces={["misc", "approvals", "common"]}>{children}</ModuleMessages>;
}
