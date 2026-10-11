import { ModuleMessages } from "@/components/i18n/module-messages";

/** Work packages show their tables and linked records through the engineering dictionary. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ModuleMessages namespaces={["engineering"]}>{children}</ModuleMessages>;
}
