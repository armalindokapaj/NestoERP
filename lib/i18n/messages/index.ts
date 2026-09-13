import type { Locale } from "../config";
import { en, type Messages } from "./en";
import { sq } from "./sq";

export type { Messages };

export const messages: Record<Locale, Messages> = { en, sq };
