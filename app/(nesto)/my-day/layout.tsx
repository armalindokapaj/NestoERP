import { ModuleMessages } from "@/components/i18n/module-messages";

/** The small pages' strings for the Client Components beneath it. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ModuleMessages namespaces={["misc"]}>{children}</ModuleMessages>;
}
