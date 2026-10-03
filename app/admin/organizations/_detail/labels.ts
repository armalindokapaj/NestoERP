import type { Translate } from "@/lib/i18n/translator";

type T = Translate<"adminOrgs">;

const WORD = {
  ACTIVE: "statusWord.ACTIVE", SUSPENDED: "statusWord.SUSPENDED", INACTIVE: "statusWord.INACTIVE", ARCHIVED: "statusWord.ARCHIVED", DELETED: "statusWord.DELETED",
  IMPLEMENTING: "statusWord.IMPLEMENTING", READY_FOR_VALIDATION: "statusWord.READY_FOR_VALIDATION", PENDING: "statusWord.PENDING", INVITED: "statusWord.INVITED",
} as const;

const LABEL = {
  ACTIVE: "statusLabel.ACTIVE", SUSPENDED: "statusLabel.SUSPENDED", INACTIVE: "statusLabel.INACTIVE", ARCHIVED: "statusLabel.ARCHIVED", DELETED: "statusLabel.DELETED",
  PENDING: "statusLabel.PENDING", INVITED: "statusLabel.INVITED", FINISHED: "statusLabel.FINISHED", IMPLEMENTING: "statusLabel.IMPLEMENTING", READY_FOR_VALIDATION: "statusLabel.READY_FOR_VALIDATION",
} as const;

const THREE_D = {
  PUBLIC: "threeD.PUBLIC", COMPANY_ONLY: "threeD.COMPANY_ONLY", PRIVATE: "threeD.PRIVATE", OFFLINE: "threeD.OFFLINE",
  Public: "threeD.Public", "Company users": "threeD.Company users", Private: "threeD.Private", Offline: "threeD.Offline", "Not configured": "threeD.Not configured",
} as const;

/** A status inside a sentence ("... is suspended"); the lower-cased raw value when unknown. */
export function statusWord(t: T, status: string): string {
  const key = WORD[status as keyof typeof WORD];
  return key ? t(key) : status.toLowerCase();
}

/** A status as a capitalised word; the humanised raw value when unknown. */
export function statusLabel(t: T, status: string): string {
  const key = LABEL[status as keyof typeof LABEL];
  return key ? t(key) : status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

/** A 3D state or audience as shown to the reader; the raw value when unknown. */
export function threeDLabel(t: T, state: string): string {
  const key = THREE_D[state as keyof typeof THREE_D];
  return key ? t(key) : state;
}
