import { ModuleMessages } from "@/components/i18n/module-messages";

/** The Approvals Center's strings, and the shared ones its discussion panel reads. */
export default function ApprovalsLayout({ children }: { children: React.ReactNode }) {
  return <ModuleMessages namespaces={["approvals", "common"]}>{children}</ModuleMessages>;
}
