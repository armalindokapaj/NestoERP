import { describe, expect, it } from "vitest";

import { compileCatalogue, holesOf, samplePattern, translateSentences, translateText, type Catalogue } from "@/lib/i18n/catalogue";

/**
 * The catalogue translator (lib/i18n/catalogue.ts): finished English text is
 * found by its own wording, exact first, then by pattern. What it cannot find
 * it leaves alone, and it never half-translates.
 */

const rows = {
  "That record does not exist.": "Ai regjistrim nuk ekziston.",
  "Reload the record and try again.": "Ringarkoni regjistrimin dhe provoni përsëri.",
  "Amendment {0} already exists on this contract.": "Amendamenti {0} ekziston tashmë në këtë kontratë.",
  "Amendment {0} is still in progress on this contract. Finish or cancel it first.": "Amendamenti {0} është ende në proces në këtë kontratë. Përfundojeni ose anulojeni më parë.",
  "{0} moved from {1} to {2}.": { sq: "{0} kaloi nga {1} në {2}.", slots: { 1: "status", 2: "status" } },
  "Another record already uses this {label}. Choose a different {label}.": "Një regjistrim tjetër e përdor tashmë këtë vlerë për fushën “{label}”. Zgjidhni një tjetër.",
  "Enter {0}.": { sq: "Shkruani {0}.", slots: { 0: "label!" } },
  "{0}: {1}": "{0}: {1}",
} satisfies Catalogue;

const catalogue = compileCatalogue(rows);
const terms = (kind: string, english: string) => {
  if (kind === "status") return ({ Draft: "Draft", Approved: "Miratuar", Rejected: "Refuzuar" } as Record<string, string>)[english];
  if (kind === "label") return ({ "a title": "një titull" } as Record<string, string>)[english];
  return undefined;
};

describe("translateText", () => {
  it("answers an exact sentence with its entry", () => {
    expect(translateText(catalogue, "That record does not exist.")).toBe("Ai regjistrim nuk ekziston.");
  });

  it("fills a pattern's holes with what the English carried", () => {
    expect(translateText(catalogue, "Amendment AM-2026-004 already exists on this contract.")).toBe("Amendamenti AM-2026-004 ekziston tashmë në këtë kontratë.");
  });

  it("tries the most specific pattern first", () => {
    expect(translateText(catalogue, "Amendment AM-7 is still in progress on this contract. Finish or cancel it first.")).toBe(
      "Amendamenti AM-7 është ende në proces në këtë kontratë. Përfundojeni ose anulojeni më parë.",
    );
  });

  it("translates a word carried in a hole through the caller's terms, and keeps an unknown one", () => {
    expect(translateText(catalogue, "Invoice INV-9 moved from Draft to Approved.", terms)).toBe("Invoice INV-9 kaloi nga Draft në Miratuar.");
    expect(translateText(catalogue, "Invoice INV-9 moved from Draft to Disputed.", terms)).toBe("Invoice INV-9 kaloi nga Draft në Disputed.");
  });

  it("holds a repeated hole to the same text both times", () => {
    expect(translateText(catalogue, "Another record already uses this code. Choose a different code.")).toBe(
      "Një regjistrim tjetër e përdor tashmë këtë vlerë për fushën “code”. Zgjidhni një tjetër.",
    );
    expect(translateText(catalogue, "Another record already uses this code. Choose a different name.")).toBeUndefined();
  });

  it("matches a pattern with a required word only when the word is known", () => {
    expect(translateText(catalogue, "Enter a title.", terms)).toBe("Shkruani një titull.");
    expect(translateText(catalogue, "Enter the dragon.", terms)).toBeUndefined();
    expect(translateText(catalogue, "Enter a title.")).toBeUndefined();
  });

  it("leaves out a pattern with almost no fixed text", () => {
    expect(catalogue.patterns.map((pattern) => pattern.key)).not.toContain("{0}: {1}");
    expect(translateText(catalogue, "Reason: too late")).toBeUndefined();
  });

  it("accepts a short pattern from a catalogue that sets its own floor", () => {
    const activity = compileCatalogue({ "created {name}": "krijoi {name}" }, { leastFixedLetters: 4 });
    expect(translateText(activity, "created Riverside Residences")).toBe("krijoi Riverside Residences");
    expect(translateText(compileCatalogue({ "created {name}": "krijoi {name}" }), "created Riverside Residences")).toBeUndefined();
  });

  it("splits two holes side by side where the second is one of a known set of words", () => {
    const statuses = ["active", "on hold", "suspended", "approved", "approved with comments"];
    const sideBySide = compileCatalogue(
      {
        "marked {name} {status}": { sq: "shënoi {name} si “{status}”", slots: { status: "status!" } },
        "reviewed {label}: {decision} by {name}": { sq: "{name} rishikoi {label}: {decision}", slots: { decision: "status!" } },
      },
      { leastFixedLetters: 4, words: (kind) => (kind === "status" ? statuses : undefined) },
    );
    const albanian = (_kind: string, english: string) => ({ active: "aktiv", "on hold": "pezulluar", suspended: "pezulluar", approved: "miratuar", "approved with comments": "miratuar me komente" } as Record<string, string>)[english];
    // The name ends where a status begins — not at its first space, which an open match would take.
    expect(translateText(sideBySide, "marked Alfa Group shpk on hold", albanian)).toBe("shënoi Alfa Group shpk si “pezulluar”");
    expect(translateText(sideBySide, "marked WP-014 active", albanian)).toBe("shënoi WP-014 si “aktiv”");
    // The longest word that fits, not the first that starts the same way.
    expect(translateText(sideBySide, "reviewed DRW-A-101 Rev B: approved with comments by Ana", albanian)).toBe("Ana rishikoi DRW-A-101 Rev B: miratuar me komente");
    // A word outside the set is not this sentence at all.
    expect(translateText(sideBySide, "marked Alfa Group shpk frobnicated", albanian)).toBeUndefined();
  });

  it("keeps a pattern with no fixed text when one of its holes must be a known word", () => {
    const replies = compileCatalogue(
      { "{who} {verb} {record}": { sq: "{who} {verb} {record}", slots: { verb: "reply!" } }, "{a} {b}": "{a} {b}" },
      { words: (kind) => (kind === "reply" ? ["accepted", "tentatively accepted"] : undefined) },
    );
    const albanian = (_kind: string, english: string) => ({ accepted: "pranoi ftesën për", "tentatively accepted": "pranoi me rezervë ftesën për" } as Record<string, string>)[english];
    expect(replies.patterns.map((pattern) => pattern.key)).toEqual(["{who} {verb} {record}"]);
    expect(translateText(replies, "Arben Hoxha tentatively accepted Weekly site meeting", albanian)).toBe("Arben Hoxha pranoi me rezervë ftesën për Weekly site meeting");
    expect(translateText(replies, "Arben Hoxha rescheduled Weekly site meeting", albanian)).toBeUndefined();
  });

  it("leaves a required kind with no word list to the caller's terms, as before", () => {
    const open = compileCatalogue(rows, { words: () => undefined });
    expect(translateText(open, "Enter a title.", terms)).toBe("Shkruani një titull.");
    expect(translateText(open, "Enter the dragon.", terms)).toBeUndefined();
  });

  it("tries the sentence with more fixed text first, punctuation and all", () => {
    const bodies = compileCatalogue({ "{count} documents": "Dokumente: {count}", "{purpose} · {count} documents": "{purpose} · dokumente: {count}" }, { leastFixedLetters: 1 });
    expect(translateText(bodies, "For review · 12 documents")).toBe("For review · dokumente: 12");
    expect(translateText(bodies, "12 documents")).toBe("Dokumente: 12");
  });

  it("treats a row nobody has translated yet as no entry", () => {
    const partial = compileCatalogue({ "Saved.": "__TODO__", "Archived {0}.": { sq: "__TODO__" }, "Deleted.": "U fshi." });
    expect(translateText(partial, "Saved.")).toBeUndefined();
    expect(translateText(partial, "Archived INV-1.")).toBeUndefined();
    expect(translateText(partial, "Deleted.")).toBe("U fshi.");
  });

  it("never touches a machine code, an empty text or a text with no entry", () => {
    for (const code of ["RATE_LIMITED", "COMMENT_TOO_LONG", "WORKSPACE_CHANGED"]) expect(translateText(catalogue, code)).toBeUndefined();
    expect(translateText(catalogue, "")).toBeUndefined();
    expect(translateText(catalogue, "Nobody wrote an entry for this.")).toBeUndefined();
    expect(translateText(catalogue, "x".repeat(900))).toBeUndefined();
  });

  it("lets a later catalogue replace an earlier entry", () => {
    const merged = compileCatalogue([rows, { "That record does not exist.": "Ky regjistrim nuk ekziston." }]);
    expect(translateText(merged, "That record does not exist.")).toBe("Ky regjistrim nuk ekziston.");
  });
});

describe("translateSentences", () => {
  it("translates a joined message sentence by sentence", () => {
    expect(translateSentences(catalogue, "That record does not exist. Reload the record and try again.")).toBe(
      "Ai regjistrim nuk ekziston. Ringarkoni regjistrimin dhe provoni përsëri.",
    );
  });

  it("gives up on the whole message when one sentence has no entry", () => {
    expect(translateSentences(catalogue, "That record does not exist. Ask somebody who knows.")).toBeUndefined();
  });

  it("prefers the message's own entry to its parts", () => {
    expect(translateSentences(catalogue, "Amendment AM-7 is still in progress on this contract. Finish or cancel it first.")).toContain("është ende në proces");
  });
});

describe("pattern helpers", () => {
  it("names the holes of a text once each, in order", () => {
    expect(holesOf("{count} of {total}: {count}")).toEqual(["count", "total"]);
    expect(holesOf("No holes here.")).toEqual([]);
  });

  it("finds every pattern again from a sample of itself", () => {
    for (const pattern of catalogue.patterns) {
      const sample = samplePattern(pattern.key, (hole, index) => (hole === "0" && pattern.key === "Enter {0}." ? "a title" : ["Alpha", "Draft", "Approved"][index % 3]));
      expect(translateText(catalogue, sample, terms), pattern.key).toBeDefined();
    }
  });
});
