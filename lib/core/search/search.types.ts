import type { ModuleKey } from "@/config/modules";
import type { UserContext } from "@/lib/context/types";

/**
 * Global search contracts (PRD #26 §15-§21).
 *
 * Search is a discovery layer, never an ownership layer. Each module answers
 * for its own records through a provider, so scope logic lives once — in the
 * module that owns it (PRD #26 §4, §18, §19).
 */

export type GlobalSearchQuery = {
  text: string;
  limitPerProvider: number;
  moduleKeys?: string[];
};

export type GlobalSearchResultDTO = {
  moduleKey: string;
  entityType: string;
  entityId: string;
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  href: string;
  score: number;
  status?: string | null;
};

export type GlobalSearchProvider = {
  moduleKey: ModuleKey;
  entityTypes: string[];
  search(context: UserContext, query: GlobalSearchQuery): Promise<GlobalSearchResultDTO[]>;
};

export type GlobalSearchResponseDTO = {
  query: string;
  results: GlobalSearchResultDTO[];
  groups: Array<{ moduleKey: string; count: number }>;
  partial: boolean;
  failedModules: string[];
};

/**
 * Ranking weights (PRD #26 §44).
 *
 * An exact business number outranks everything: somebody typing PO-2026-0042
 * wants that purchase order, not a project whose description mentions it.
 */
export const SCORE = {
  EXACT_CODE: 100,
  EXACT_TITLE: 95,
  PREFIX_TITLE: 85,
  WORD_START: 75,
  EXACT_SECONDARY: 70,
  PREFIX_SECONDARY: 60,
  CONTAINS: 45,
  FUZZY: 35,
} as const;

/** Normalises for comparison: case, accents and stray whitespace (PRD #26 §49). */
export function normalise(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** Scores one candidate against the query (PRD #26 §43, §44). */
export function scoreMatch(query: string, title: string, code?: string | null): number {
  const q = normalise(query);
  const t = normalise(title);

  if (code && normalise(code) === q) return SCORE.EXACT_CODE;
  if (code && normalise(code).startsWith(q)) return SCORE.EXACT_CODE - 5;
  if (t === q) return SCORE.EXACT_TITLE;
  if (t.startsWith(q)) return SCORE.PREFIX_TITLE;
  if (t.split(" ").some((word) => word.startsWith(q))) return SCORE.WORD_START;
  if (t.includes(q)) return SCORE.CONTAINS;
  return SCORE.FUZZY;
}
