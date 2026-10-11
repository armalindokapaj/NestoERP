import { ModuleMessages } from "@/components/i18n/module-messages";

/** The department controls here are the group's own Organization ones (E-13 §51): their dictionary comes with them. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ModuleMessages namespaces={["organization"]}>{children}</ModuleMessages>;
}
