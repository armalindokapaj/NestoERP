import { ModuleMessages } from "@/components/i18n/module-messages";

/** The tab shows Contractors' tables, which name due dates and people through the engineering dictionary. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ModuleMessages namespaces={["engineering"]}>{children}</ModuleMessages>;
}
