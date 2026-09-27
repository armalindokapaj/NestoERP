import type { Locale } from "../config";
import { dashboardEn } from "./dashboard/en";
import { dashboardSq } from "./dashboard/sq";
import { tasksEn } from "./tasks/en";
import { tasksSq } from "./tasks/sq";

/**
 * Module dictionaries.
 *
 * Kept apart from the application frame's dictionary (`../messages`) because
 * that one ships to every page. A module's strings reach the browser only
 * where its layout mounts `ModuleMessages` for it; Server Components read them
 * directly through `getTranslations`, the same as any other namespace.
 *
 * English is the source: each Albanian module dictionary is typed against it.
 */
export const moduleMessagesEn = {
  dashboard: dashboardEn,
  tasks: tasksEn,
};

export type ModuleMessages = typeof moduleMessagesEn;
export type ModuleNamespace = keyof ModuleMessages;

export const moduleMessages: Record<Locale, ModuleMessages> = {
  en: moduleMessagesEn,
  sq: { dashboard: dashboardSq, tasks: tasksSq },
};
