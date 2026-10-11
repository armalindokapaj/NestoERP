import { ModuleMessages } from "@/components/i18n/module-messages";

/** The tab shows QA/QC's own tables; their result and severity badges read its dictionary in the browser. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ModuleMessages namespaces={["qaqc"]}>{children}</ModuleMessages>;
}
