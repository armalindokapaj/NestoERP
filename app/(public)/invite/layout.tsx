import { ModuleMessages } from "@/components/i18n/module-messages";

/** The invitation forms' strings, in the reader's language. */
export default function InviteLayout({ children }: { children: React.ReactNode }) {
  return <ModuleMessages namespaces={["misc"]}>{children}</ModuleMessages>;
}
