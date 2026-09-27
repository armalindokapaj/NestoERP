import { ModuleMessagesProvider } from "@/components/i18n/i18n-provider";
import type { ModuleNamespace } from "@/lib/i18n/modules";
import { getModuleDictionaries } from "@/lib/i18n/server";

/**
 * Makes these modules' strings available to the Client Components beneath it,
 * in the reader's language. Only the named modules are sent to the browser.
 */
export async function ModuleMessages({
  namespaces,
  children,
}: {
  namespaces: readonly ModuleNamespace[];
  children: React.ReactNode;
}) {
  const messages = await getModuleDictionaries(namespaces);
  return <ModuleMessagesProvider messages={messages}>{children}</ModuleMessagesProvider>;
}
